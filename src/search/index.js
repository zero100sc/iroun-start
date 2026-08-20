/**
 * 공고 검색 실행기.
 *
 * 기획서의 계층형 후보검색(Tier 1~5)을 PostgreSQL 만으로 구현한 것이다.
 *
 *   질의계획  → 개념그룹 AND / 그룹내 동의어 OR
 *   정확구문  → 큰따옴표는 원문 그대로 일치해야 함
 *   BM25F풍  → 필드 가중치 × 희귀어 IDF
 *   일치등급  → exact > synonym > partial 순으로 먼저 가르고, 등급 안에서 점수 정렬
 *   완화검색  → 엄격검색 결과가 부족할 때만 발동하며, 결과에 그 사실을 표시
 *
 * 절대 어기면 안 되는 규칙 하나:
 *   '지원'·'활용'·'생산' 같은 일반어만 걸린 문서는 어떤 경우에도 결과에 넣지 않는다.
 *   (일반어는 개념그룹이 되지 못하므로 group_hits 조건이 이를 구조적으로 보장한다)
 */
const { planQuery, WEIGHT } = require('./query-plan');
const { expandToDomains } = require('./domains');
const R = require('./rank');

const PROGRAM_FIELDS = `program_id, source_portal, name, agency, field, region,
  amount_text, funding_type, period_start, period_end, is_open,
  detail_url, summary, normalized_tags, target_stages, synced_at`;

// 엄격검색 결과가 이 수보다 적으면 완화검색을 함께 돌린다(기획서 4장 Tier 5).
const MIN_STRICT_RESULTS = 5;

/**
 * 지역 필터.
 *
 * region 을 정확히 일치시키면 안 된다. inferRegion 은 전국 대상 공고뿐 아니라
 * 지역을 판단하지 못한 공고까지 '전국' 으로 넣기 때문에(normalize/korean.js) 그 값이
 * 코퍼스의 다수를 차지한다. 서울을 고른 사용자에게서 정작 신청 가능한 전국 공고가
 * 통째로 사라지는 문제가 있었다. (2026-08-19 리뷰에서 발견)
 */
function regionSql(region, params) {
  const p = params.add(region);
  return `(region = ${p} OR region = '전국')`;
}

const TIER_LABEL = { 4: 'exact', 3: 'synonym', 2: 'partial', 1: 'weak' };
const TIER_TEXT  = {
  exact:   '정확 일치',
  synonym: '동의어 일치',
  partial: '일부 일치',
  weak:    '참고 결과',
  // 점수로 유도되지 않는 유일한 등급 — 분야 확장 검색이 통째로 이 등급을 쓴다.
  // (public/search.html 의 .tier.domain 스타일이 이 키를 그대로 쓴다)
  domain:  '분야 확장',
};

/**
 * @param {import('pg').Pool} pool
 * @param {{q:string, region?:string, openOnly?:boolean, page?:number, pageSize?:number}} opts
 */
async function searchPrograms(pool, opts) {
  const q        = String(opts.q || '').trim().slice(0, 120);
  const region   = String(opts.region || '').trim().slice(0, 50);
  const openOnly = Boolean(opts.openOnly);
  const pageSize = Math.min(Math.max(parseInt(opts.pageSize, 10) || 20, 1), 50);
  const page     = Math.min(Math.max(parseInt(opts.page, 10) || 1, 1), 500);

  const plan = planQuery(q);
  const { groups, phrases } = plan;

  // 검색어가 아예 없으면 목록 열람으로 취급한다.
  // 원문(q)이 아니라 정규화 결과를 봐야 한다. '·' 나 '「」' 만 친 경우 q 는 참이지만
  // 정규화하면 빈 문자열이 되는데, 예전에는 이게 weakSearch 로 흘러가 조건 0개짜리
  // 질의가 되어 전체 5,326건을 '검색 결과' 로 돌려줬다. (2026-08-19 리뷰에서 발견)
  const hasAnyTerm = groups.length || phrases.length || plan.generic.length || plan.intent.length;
  if (!q || !hasAnyTerm) return browse(pool, { region, openOnly, page, pageSize, plan });

  // 핵심어가 하나도 없는 질의('지원사업' 같은) — 일반어로라도 훑되 등급을 낮게 준다.
  if (!groups.length && !phrases.length) {
    return weakSearch(pool, { plan, region, openOnly, page, pageSize });
  }

  // ── 희귀도 계산 (캐시됨) ──
  const { total: corpusSize, dfs } = await R.cachedGroupDocFrequencies(pool, groups);
  const idfs = dfs.map((df) => R.idfWeight(df, corpusSize));

  const common = { plan, groups, phrases, idfs, region, openOnly, page, pageSize };

  // ── 1차: 엄격검색 ──
  // 모든 개념그룹이 걸리는 행만 후보로 삼는다. AND 라 후보가 극히 적고, 그 소수에만
  // 점수를 매기므로 빠르다. 기획서의 Tier 1~2 에 해당한다.
  const strict = await runPass(pool, { ...common, mode: 'strict' });

  // 개념이 하나뿐이면 완화 조건(_hits >= 1)이 엄격 조건(_hits = 1)과 글자만 다를 뿐 같다.
  // 그대로 두면 똑같은 질의를 두 번 돌리고, 게다가 전부 '정확 일치' 인 결과를 두고
  // "일부만 맞는 공고도 함께 보여드립니다" 라고 잘못 안내한다. (2026-08-19 리뷰에서 발견)
  // 완화검색이 실제로 다른 결과를 낼 수 있을 때만 돌린다.
  // 완화되는 것은 '개념을 몇 개나 만족해야 하는가' 하나뿐이므로, 개념이 둘 이상일
  // 때만 의미가 있다. 구문 조건은 두 모드에서 똑같이 적용되니 여기 끼워 넣으면 안 된다
  // — 같은 질의를 두 번 돌리고, 전부 정확 일치인 결과를 두고 "일부만 맞는 공고" 라고
  // 잘못 안내하게 된다.
  const relaxWouldDiffer = groups.length > 1;
  if (strict.total >= MIN_STRICT_RESULTS || !relaxWouldDiffer) {
    const expanded = await tryExpand(pool, {
      hits: strict.total, plan, groups, phrases, dfs,
      region, openOnly, page, pageSize, strictCount: strict.total, corpusSize,
    });
    if (expanded) return expanded;

    return shape({ ...strict, plan, groups, page, pageSize,
                   relaxed: false, strictCount: strict.total, corpusSize, dfs });
  }

  // ── 2차: 완화검색 ──
  // 여기서만 넓게 훑는다(기획서 Tier 5 — "정확한 결과가 부족할 때만").
  //
  // 다만 한 번에 '하나만 걸려도 통과' 로 풀면 안 된다. 개념 5개를 친 사용자에게
  // 그중 하나만 스친 공고 2,000건을 주는 것은 답이 아니다. 절반부터 단계적으로 푼다.
  const half = Math.max(1, Math.ceil(groups.length / 2));
  let loose = await runPass(pool, { ...common, mode: 'relaxed', minHits: half });

  // 절반으로도 한 건도 없으면 그때 끝까지 푼다.
  if (!loose.total && half > 1) {
    loose = await runPass(pool, { ...common, mode: 'relaxed', minHits: 1 });
  }

  // ── 3차: 분야 확장 ──
  const expanded = await tryExpand(pool, {
    hits: loose.total, plan, groups, phrases, dfs,
    region, openOnly, page, pageSize, strictCount: strict.total, corpusSize,
  });
  if (expanded) return expanded;

  return shape({ ...loose, plan, groups, page, pageSize,
                 relaxed: true, strictCount: strict.total, corpusSize, dfs });
}

/**
 * 분야 확장을 시도할지 판단하고, 조건이 맞으면 실행한다.
 *
 * 확장은 최후의 수단이다. 발동 조건을 틀리면 정확한 검색을 망치므로 세 관문을 둔다.
 *
 * 1) 결과가 0건일 것 — 기획서의 "정확 결과가 부족할 때만".
 *
 * 2) **검색어가 코퍼스에 정말로 없을 것.** 0건이라고 다 같은 0건이 아니다.
 *    지역·모집중 필터 때문에 0건이 된 것을 '그런 공고가 없다' 고 말하면 거짓말이다.
 *    실제로 '오폐수' + 모집중만 은 0건이 되는데(5건 있으나 전부 마감), 예전 코드는
 *    "오폐수가 들어간 공고는 없습니다" 라며 엉뚱한 58건을 보여줬다.
 *    dfs 는 필터를 타지 않은 개념별 문서수라 이 판단에 그대로 쓸 수 있다 —
 *    전부 0 이어야 그 말이 코퍼스에 없는 것이다. (2026-08-20 리뷰에서 발견)
 *
 * 3) 큰따옴표 구문이 없을 것 — 구문은 이 엔진에서 유일하게 '원문에 그대로 있음' 을
 *    약속하는 장치다. 확장은 그 약속을 지킬 수 없으므로 아예 손대지 않는다.
 */
async function tryExpand(pool, { hits, plan, groups, phrases, dfs, region, openOnly,
                                 page, pageSize, strictCount, corpusSize }) {
  if (hits) return null;
  if (phrases && phrases.length) return null;
  if (!groups.length) return null;
  if (!dfs || !dfs.every((df) => df === 0)) return null;

  return domainSearch(pool, { plan, groups, region, openOnly, page, pageSize, strictCount, corpusSize });
}

/**
 * 분야 확장 검색.
 *
 * 검색어 자체는 버리고, 그 말이 속한 분야의 어휘로 다시 찾는다.
 * 결과는 '분야 확장' 등급으로만 표시한다 — 사용자가 친 말이 실제로 들어있는 공고가
 * 아니므로, 정확 일치인 척하면 안 된다.
 *
 * 확장어는 domains.js 의 검증된 표에서만 나온다. AI 는 분야를 고르기만 한다.
 */
async function domainSearch(pool, { plan, groups, region, openOnly, page, pageSize, strictCount, corpusSize }) {
  const primaries = groups.map((g) => g.primary);

  // 어간뿐 아니라 사용자가 실제로 친 말도 넘긴다.
  // '떡볶이' 는 조사 절단으로 primary 가 '떡볶' 이 되는데, 사전에 있는 쪽은 '떡볶이' 다.
  // (원형은 query-plan 이 대안어로 보존해 둔다)
  const lookupTerms = [...new Set([
    ...primaries,
    ...groups.flatMap((g) => g.alternatives.flatMap((a) => a.terms)),
  ])];

  const exp = await expandToDomains(lookupTerms);
  if (!exp || !exp.terms.length) return null;

  // 분야 어휘 전체를 개념 하나로 묶는다 — 그 안에서는 OR 다.
  // (어휘 고르기와 개수 제한은 domains.js 의 pickTerms 가 한다)
  const domainGroup = {
    primary: exp.labels.join(' · '),
    alternatives: exp.terms.map((t) => ({ terms: [t], weight: WEIGHT.synonym, kind: 'domain' })),
  };

  // idf 는 계산하지 않는다. 개념이 하나뿐이면 _score 가 곧 _g0 이고, 거기 곱해지는
  // 양수 상수는 정렬(ORDER BY _score DESC)도 _hits 도 _tier 도 바꾸지 못한다.
  // 굳이 구하면 전체 스캔 한 번을 공짜로 버리는 셈이다 — 이미 느린 경로다.
  const res = await runPass(pool, {
    plan, groups: [domainGroup], phrases: [], idfs: [1],
    region, openOnly, page, pageSize, mode: 'relaxed', minHits: 1,
  });
  if (!res.total) return null;

  const shaped = shape({ ...res, plan, groups: [domainGroup], page, pageSize,
                         relaxed: true, strictCount, corpusSize, dfs: null,
                         tier: 'domain' });

  // 확장으로 얻은 결과라는 사실을 결과 안에 분명히 남긴다.
  shaped.expansion = {
    applied: true,
    original: primaries,
    domains: exp.keys.map((k, i) => ({ key: k, label: exp.labels[i] })),
    terms: exp.terms,
    reason: exp.reason,
    source: exp.source,
  };
  return shaped;
}

/**
 * 검색 한 번(엄격 또는 완화)을 실제로 실행한다.
 *
 * mode='strict'  후보 = 모든 개념그룹이 걸리는 행 (AND — 좁고 빠르다)
 * mode='relaxed' 후보 = 하나라도 걸리는 행       (OR — 넓고 느리다)
 *
 * 후보를 좁히는 조건과 점수를 매기는 식이 같은 단어를 쓰므로, TermIndex 로 한 번만 계산한다.
 */
async function runPass(pool, { plan, groups, phrases, idfs, region, openOnly, page, pageSize, mode, minHits = 1 }) {
  const params = new R.Params();
  const ti = new R.TermIndex(params);

  const groupScore = groups.map((g, i) => `${R.groupScoreSql(g, idfs[i], ti)} AS _g${i}`);
  const groupExact = groups.map((g, i) => `${R.groupExactHitSql(g, ti)} AS _e${i}`);
  const phraseRefs = phrases.map((p) => ti.ref(p));
  const phraseOk = phraseRefs.length ? phraseRefs.map((r) => `${r} > 0`).join(' AND ') : 'TRUE';

  // 후보 조건. 여기서 trigram 색인이 쓰인다(단일 컬럼 search_blob 비교라 그대로 탄다).
  const groupAny = groups.map((g) => {
    const terms = [...new Set(g.alternatives.flatMap((a) => a.terms))];
    return `(${terms.map((t) => R.termHitSql(t, params)).join(' OR ')})`;
  });
  const phraseAll = phrases.map((p) => R.phraseHitSql(p, params));

  // 큰따옴표 구문은 어느 모드에서도 양보하지 않는다.
  // 사용자가 따옴표를 쳤다는 건 '이 말이 원문에 그대로 있는 것만' 이라는 뜻이고,
  // 이 엔진에서 그 약속을 하는 장치는 이것 하나뿐이다.
  //
  // 예전에는 완화 모드에서 phraseAll 을 후보 조건에 넣지 않았다. 그런데 조건식은
  // 이미 만들어 둔 뒤라 파라미터만 등록되고 SQL 에는 안 들어가, 개념 하나 + 구문
  // 질의가 'could not determine data type of parameter $6' 로 터졌다.
  // (2026-08-20, relaxWouldDiffer 를 고쳐 이 경로가 처음 열리면서 드러났다)
  const candidate = [];
  if (mode === 'strict') {
    candidate.push(...groupAny, ...phraseAll);          // 개념도 구문도 전부 만족해야 함
  } else if (groupAny.length) {
    candidate.push(`(${groupAny.join(' OR ')})`, ...phraseAll);  // 개념은 하나만, 구문은 전부
  } else if (phraseAll.length) {
    candidate.push(...phraseAll);
  }

  const filters = candidate.length ? [candidate.join(' AND ')] : [];
  if (region)   filters.push(regionSql(region, params));
  if (openOnly) filters.push('is_open = TRUE AND (period_end IS NULL OR period_end >= CURRENT_DATE)');
  const filterSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const n = groups.length;
  const hitCount   = n ? groups.map((_, i) => `(CASE WHEN _g${i} > 0 THEN 1 ELSE 0 END)`).join(' + ') : '0';
  const exactCount = n ? groups.map((_, i) => `(CASE WHEN _e${i} THEN 1 ELSE 0 END)`).join(' + ') : '0';
  const scoreParts = [...groups.map((_, i) => `_g${i}`), ...phraseRefs];
  const scoreSum   = scoreParts.length ? scoreParts.join(' + ') : '0';

  // 안쪽: 단어 점수만 계산. 바깥: 그 값으로 그룹·구문·등급을 유도.
  const base = `
    SELECT ${[PROGRAM_FIELDS, ...ti.columns()].join(',\n           ')}
      FROM gov_program
      ${filterSql}`;

  const derived = `
    SELECT *, ${[...groupScore, ...groupExact, `(${phraseOk}) AS _phrase_ok`].join(',\n           ')}
      FROM b`;

  const mid = `
    SELECT *, (${scoreSum}) AS _score,
           (${hitCount}) AS _hits,
           (${exactCount}) AS _exact
      FROM d`;

  // 일치 등급 — 기획서 5장 'A/B/C/D 등급' 을 정수로 옮긴 것.
  const tierSql = `
    CASE WHEN _phrase_ok AND _exact = ${n} AND _hits = ${n} THEN 4
         WHEN _phrase_ok AND _hits  = ${n}                  THEN 3
         WHEN _hits >= 1                                    THEN 2
         ELSE 1 END`;

  // ── 최적화 울타리 ────────────────────────────────────────────────
  // 그냥 중첩 서브질의로 두면 PostgreSQL 이 전부 평탄화한다. 그러면 단어 점수식이
  // Seq Scan 의 Filter 와 WindowAgg, 그리고 Sort Key 에 각각 통째로 인라인되어
  // 같은 계산을 세 번 한다. 바깥의 WHERE 까지 스캔으로 밀려 내려가는 바람에
  // 후보 걸러내기에 trigram 색인도 못 쓴다.
  //
  // 2026-08-20 EXPLAIN 실측 ('바이오', 본문 색인 후):
  //   Seq Scan 1,302ms (4,196행 버림) + 재계산 595ms = 1,903ms
  //
  // MATERIALIZED 로 못을 박으면 각 단계가 딱 한 번씩만 돈다.
  // b 는 색인으로 후보만 추리고, 점수 계산은 그 소수의 행에서만 일어난다.
  const scored = `
    WITH b AS MATERIALIZED (${base}),
         d AS MATERIALIZED (${derived}),
         m AS MATERIALIZED (${mid})
    SELECT *, (${tierSql}) AS _tier FROM m`;

  // 후보 조건만으로는 부족하다 — 예컨대 동의어가 제목에만 스친 행도 후보엔 들어온다.
  // 최종 판정은 점수 기준으로 다시 한다.
  // 완화되는 것은 '개념을 몇 개나 만족해야 하는가' 뿐이다. 구문 조건은 그대로 둔다.
  const where = mode === 'strict'
    ? `_phrase_ok AND _hits = ${n}`
    : (n > 0 ? `_phrase_ok AND _hits >= ${minHits}` : '_phrase_ok');

  // 페이지 파라미터를 붙이기 전의 개수를 기억해 둔다.
  // 아래 폴백 COUNT 질의는 LIMIT/OFFSET 을 쓰지 않으므로, 그 두 개까지 넘기면
  // "bind message supplies 10 parameters, but prepared statement requires 8" 로 터진다.
  const paramsBeforePaging = params.values.length;

  const limitP  = params.add(pageSize);
  const offsetP = params.add((page - 1) * pageSize);
  const res = await pool.query(
    `SELECT *, COUNT(*) OVER ()::int AS _total
       FROM (${scored}) AS t
      WHERE ${where}
      ORDER BY _tier DESC, _score DESC, is_open DESC, period_end ASC NULLS LAST, name ASC
      LIMIT ${limitP} OFFSET ${offsetP}`, params.values);

  // OFFSET 이 끝을 넘으면 행이 0개라 _total 을 못 읽는다. 그때만 따로 센다.
  let total = res.rows[0] ? res.rows[0]._total : 0;
  if (!res.rows.length && page > 1) {
    const c = await pool.query(
      `SELECT COUNT(*)::int AS c FROM (${scored}) AS t WHERE ${where}`,
      params.values.slice(0, paramsBeforePaging));
    total = c.rows[0].c;
  }
  return { rows: res.rows, total };
}

/** 결과 행을 API 응답 모양으로 정리하고, 내부 계산 컬럼(_로 시작)은 떼어낸다. */
function shape({ rows, plan, groups, total, page, pageSize, relaxed, strictCount, corpusSize, dfs, tier: forcedTier }) {
  const items = rows.map((row) => {
    const matched = [];
    const missing = [];
    groups.forEach((g, i) => (Number(row[`_g${i}`]) > 0 ? matched : missing).push(g.primary));

    const item = {};
    for (const [k, v] of Object.entries(row)) if (!k.startsWith('_')) item[k] = v;

    // 분야 확장은 점수와 무관하게 등급이 정해져 있다 — 사용자가 친 말이 실제로
    // 들어있는 공고가 아니므로 '정확 일치' 로 보이면 안 된다.
    const tier = forcedTier || TIER_LABEL[row._tier] || 'weak';
    item.match = {
      tier,
      tierText: TIER_TEXT[tier],
      score: Math.round(Number(row._score) * 100) / 100,
      matchedTerms: matched,
      missingTerms: missing,
    };
    return item;
  });

  return {
    query: plan.original,
    normalizedQuery: plan.normalized,
    corrections: plan.corrections,
    phrases: plan.phrases,
    coreTerms: groups.map((g, i) => ({
      term: g.primary,
      synonyms: g.alternatives.filter((a) => a.kind === 'synonym').map((a) => a.terms[0]),
      docFrequency: dfs ? dfs[i] : null,
    })),
    ignoredTerms: [...plan.generic, ...plan.intent],
    warnings: plan.warnings,
    relaxed,
    strictCount,
    corpusSize,
    total, page, pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items,
  };
}

/** 핵심어가 없는 질의 — 일반어로 훑되 '참고 결과' 로만 표시한다. */
async function weakSearch(pool, { plan, region, openOnly, page, pageSize }) {
  const terms = [...plan.generic, ...plan.intent].slice(0, 4);
  const params = new R.Params();
  const where = terms.map((t) => R.termHitSql(t, params));
  if (region)   where.push(regionSql(region, params));
  if (openOnly) where.push('is_open = TRUE AND (period_end IS NULL OR period_end >= CURRENT_DATE)');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM gov_program ${whereSql}`, params.values);
  const limitP  = params.add(pageSize);
  const offsetP = params.add((page - 1) * pageSize);
  const listRes = await pool.query(
    `SELECT ${PROGRAM_FIELDS} FROM gov_program ${whereSql}
      ORDER BY is_open DESC, period_end ASC NULLS LAST, name ASC
      LIMIT ${limitP} OFFSET ${offsetP}`, params.values);

  const items = listRes.rows.map((r) => ({
    ...r,
    match: { tier: 'weak', tierText: TIER_TEXT.weak, score: 0, matchedTerms: [], missingTerms: [] },
  }));

  return {
    query: plan.original, normalizedQuery: plan.normalized, corrections: plan.corrections,
    phrases: [], coreTerms: [], ignoredTerms: [],
    warnings: plan.warnings.length ? plan.warnings
      : ['구체적인 기술·업종·지원분야를 넣으면 훨씬 정확하게 찾아드립니다.'],
    relaxed: true, strictCount: 0, corpusSize: null,
    total: countRes.rows[0].c, page, pageSize,
    totalPages: Math.max(1, Math.ceil(countRes.rows[0].c / pageSize)),
    items,
  };
}

/** 검색어 없이 들어온 경우 — 마감 임박순 목록. */
async function browse(pool, { region, openOnly, page, pageSize, plan }) {
  const params = new R.Params();
  const where = [];
  if (region)   where.push(regionSql(region, params));
  if (openOnly) where.push('is_open = TRUE AND (period_end IS NULL OR period_end >= CURRENT_DATE)');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM gov_program ${whereSql}`, params.values);
  const limitP  = params.add(pageSize);
  const offsetP = params.add((page - 1) * pageSize);
  const listRes = await pool.query(
    `SELECT ${PROGRAM_FIELDS} FROM gov_program ${whereSql}
      ORDER BY is_open DESC, period_end ASC NULLS LAST, name ASC
      LIMIT ${limitP} OFFSET ${offsetP}`, params.values);

  return {
    query: '', normalizedQuery: '', corrections: [], phrases: [], coreTerms: [],
    ignoredTerms: [], warnings: [], relaxed: false, strictCount: 0, corpusSize: null,
    total: countRes.rows[0].c, page, pageSize,
    totalPages: Math.max(1, Math.ceil(countRes.rows[0].c / pageSize)),
    items: listRes.rows.map((r) => ({ ...r, match: null })),
  };
}

module.exports = { searchPrograms, PROGRAM_FIELDS, TIER_TEXT };
