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
const { planQuery } = require('./query-plan');
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
  const relaxWouldDiffer = groups.length > 1 || (groups.length === 0 && phrases.length > 0);
  if (strict.total >= MIN_STRICT_RESULTS || !relaxWouldDiffer) {
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
  return shape({ ...loose, plan, groups, page, pageSize,
                 relaxed: true, strictCount: strict.total, corpusSize, dfs });
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

  const candidate = [];
  if (mode === 'strict') {
    candidate.push(...groupAny, ...phraseAll);          // 전부 만족해야 함
  } else if (groupAny.length) {
    candidate.push(`(${groupAny.join(' OR ')})`);       // 하나만 만족해도 됨
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
      FROM (${base}) AS b`;

  const mid = `
    SELECT *, (${scoreSum}) AS _score,
           (${hitCount}) AS _hits,
           (${exactCount}) AS _exact
      FROM (${derived}) AS d`;

  // 일치 등급 — 기획서 5장 'A/B/C/D 등급' 을 정수로 옮긴 것.
  const tierSql = `
    CASE WHEN _phrase_ok AND _exact = ${n} AND _hits = ${n} THEN 4
         WHEN _phrase_ok AND _hits  = ${n}                  THEN 3
         WHEN _hits >= 1                                    THEN 2
         ELSE 1 END`;

  const scored = `SELECT *, (${tierSql}) AS _tier FROM (${mid}) AS m`;

  // 후보 조건만으로는 부족하다 — 예컨대 동의어가 제목에만 스친 행도 후보엔 들어온다.
  // 최종 판정은 점수 기준으로 다시 한다.
  const where = mode === 'strict'
    ? `_phrase_ok AND _hits = ${n}`
    : (n > 0 ? `_hits >= ${minHits}` : '_phrase_ok');

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
function shape({ rows, plan, groups, total, page, pageSize, relaxed, strictCount, corpusSize, dfs }) {
  const items = rows.map((row) => {
    const matched = [];
    const missing = [];
    groups.forEach((g, i) => (Number(row[`_g${i}`]) > 0 ? matched : missing).push(g.primary));

    const item = {};
    for (const [k, v] of Object.entries(row)) if (!k.startsWith('_')) item[k] = v;

    const tier = TIER_LABEL[row._tier] || 'weak';
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
