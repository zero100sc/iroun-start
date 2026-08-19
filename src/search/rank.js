/**
 * 랭킹 SQL 빌더.
 *
 * 기획서 4장 'Tier 3. BM25F 검색' 과 5장 '일치 등급 우선 정렬' 을 PostgreSQL 만으로 구현한다.
 * BGE-M3·Neural Sparse 같은 임베딩 검색기는 별도 인프라가 필요해 여기 없다.
 * 대신 BM25F 의 두 축(필드별 가중치 + 희귀어 IDF 가중)은 그대로 살렸다.
 *
 * 왜 tsvector 가 아니라 ILIKE 인가:
 *  gov_program 에는 search_vector 가 없고, PostgreSQL 의 한국어 형태소 설정도 없다.
 *  simple 설정으로 색인하면 '창업보육센터' 가 통짜 lexeme 이 되어 '보육' 검색에 안 걸린다.
 *  substring 매칭은 한국어 복합명사에 대해 오히려 재현율이 높고, 5천건 규모에서는 충분히 빠르다.
 *  (실측 필요 — 코퍼스가 5만건을 넘으면 pg_trgm GIN 색인이나 전용 검색엔진을 검토할 것)
 */

// 기획서 4장 '필드 권장 상대 가중치' 를 우리 컬럼에 대응시킨 값.
// 주의: 여기 적힌 식은 migration 010 의 trigram 색인 식과 **글자까지 같아야** 한다.
// 다르면 색인을 타지 못해 질의마다 풀스캔이 돌아온다(그 상태에서 5,326행 기준 1.4~5.1초였다).
// 그래서 COALESCE 로 감싸지 않는다 — 색인 식에 COALESCE 가 없기 때문이다.
// NULL 컬럼은 ILIKE 가 NULL 을 내고 OR/CASE 에서 거짓처럼 다뤄지므로 결과에도 문제가 없다.
const FIELD_WEIGHTS = [
  { col: 'name',                             w: 5.0 },  // 공고명
  { col: 'field',                            w: 4.0 },  // 지원분야
  { col: 'gov_tags_text(normalized_tags)',   w: 3.0 },  // 정규화 태그
  { col: 'summary',                          w: 2.0 },  // 요약·본문
  { col: 'agency',                           w: 0.2 },  // 기관명 (공통 푸터성 정보)
];

/** ILIKE 패턴으로 감싸기 — 와일드카드를 무력화한다. */
const like = (t) => `%${String(t).replace(/[%_\\]/g, '\\$&')}%`;

/**
 * 짧은 영문 약어인가.
 *
 * 'IP' 를 substring 으로 찾으면 Membership·TIPS·LIPS·DIP 가 전부 걸린다.
 * 2026-08-19 실측: IP 238건 중 104건(44%)이 오탐, BI 는 80건 중 49건(61%)이 오탐이었다.
 * 한글은 단어 경계가 없어 이 문제가 없으므로, 영숫자로만 된 짧은 말에만 경계 매칭을 쓴다.
 */
const isAcronym = (t) => /^[A-Za-z0-9&.+#-]{1,3}$/.test(String(t));

/** 정규식 메타문자 무력화. */
const reEscape = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 단어 경계로 감싼 정규식 — 앞뒤가 영숫자가 아니어야 한다. */
const boundary = (t) => `(^|[^A-Za-z0-9])${reEscape(t)}([^A-Za-z0-9]|$)`;

/**
 * 한 단어에 대한 필드별 조건 생성기를 만든다.
 * 패턴 파라미터는 한 번만 등록하고 모든 필드가 나눠 쓴다.
 * 짧은 영문 약어는 경계 매칭(~*), 나머지는 부분 일치(ILIKE).
 */
function termMatcher(term, params) {
  if (isAcronym(term)) {
    const p = params.add(boundary(term));
    return (col) => `${col} ~* ${p}`;
  }
  const p = params.add(like(term));
  return (col) => `${col} ILIKE ${p}`;
}

/**
 * 파라미터를 모아 두는 작은 헬퍼.
 * SQL 문자열에 값을 절대 끼워넣지 않기 위해, 모든 검색어는 이 통로로만 들어간다.
 */
class Params {
  constructor() { this.values = []; }
  add(v) { this.values.push(v); return `$${this.values.length}`; }
}

/**
 * 한 단어가 각 필드에 있는지 보고 필드 가중치를 더한 점수식.
 *
 * 통합 컬럼(search_blob, migration 011)으로 한 번 걸러낸 뒤에야 필드별 계산에 들어간다.
 * PostgreSQL 의 CASE 는 조건이 거짓이면 THEN 절을 평가하지 않으므로, 단어가 없는 행에서는
 * ILIKE 가 5회가 아니라 1회만 돈다. 점수 자체는 감싸기 전과 완전히 같다.
 */
function termScoreSql(term, params) {
  const m = termMatcher(term, params);
  const perField = FIELD_WEIGHTS
    .map(({ col, w }) => `CASE WHEN ${m(col)} THEN ${w} ELSE 0 END`)
    .join(' + ');
  return `(CASE WHEN ${m('search_blob')} THEN (${perField}) ELSE 0 END)`;
}

/**
 * 한 단어가 어느 필드에든 있으면 참.
 * 통합 컬럼 하나만 보면 되므로 필드를 일일이 OR 로 잇던 때보다 훨씬 싸고,
 * 단일 컬럼이라 trigram 색인도 그대로 탄다.
 */
function termHitSql(term, params) {
  return termMatcher(term, params)('search_blob');
}

/**
 * 단어별 점수를 딱 한 번만 계산하도록 모아 두는 레지스트리.
 *
 * 이게 없으면 같은 단어가 점수식과 정확일치 판정에서 각각 다시 평가된다.
 * 2026-08-19 실측: 개념 5개(동의어 21개) 질의의 서버 실행시간이 1,336ms 였고 대부분이
 * 이 중복이었다. 단어 하나가 필드 5개를 훑으므로 중복 한 번이 곧 ILIKE 5회다.
 *
 * 사용법: ref(term) 이 `_t3` 같은 컬럼 별칭을 주고, columns() 를 안쪽 SELECT 절에 넣는다.
 * 바깥 질의는 그 별칭만 참조한다.
 */
class TermIndex {
  constructor(params) {
    this.params = params;
    this.byTerm = new Map();
    this.cols = [];
  }

  ref(term) {
    const key = String(term).toLowerCase();
    if (!this.byTerm.has(key)) {
      const alias = `_t${this.cols.length}`;
      this.cols.push(`${termScoreSql(term, this.params)} AS ${alias}`);
      this.byTerm.set(key, alias);
    }
    return this.byTerm.get(key);
  }

  columns() { return this.cols.slice(); }
}

/**
 * 대안 하나의 점수식.
 * 구성명사 조합처럼 단어가 여러 개면 전부 있어야 하고(AND), 점수는 가장 약한 쪽을 따른다.
 */
function alternativeScoreSql(alt, ti) {
  const refs = alt.terms.map((t) => ti.ref(t));
  if (refs.length === 1) return `${refs[0]} * ${alt.weight}`;
  const allHit = refs.map((r) => `${r} > 0`).join(' AND ');
  return `CASE WHEN ${allHit} THEN LEAST(${refs.join(', ')}) * ${alt.weight} ELSE 0 END`;
}

/** 개념 그룹 하나의 점수식 — 대안 중 가장 높은 것을 쓰고, 희귀도(idf)를 곱한다. */
function groupScoreSql(group, idf, ti) {
  const alts = group.alternatives.map((a) => alternativeScoreSql(a, ti));
  return `GREATEST(${alts.join(', ')}) * ${idf.toFixed(4)}`;
}

/** 그룹이 '입력한 말 그대로' 잡혔는지 — 일치 등급 A 판정에 쓴다. */
function groupExactHitSql(group, ti) {
  const exact = group.alternatives.filter((a) => a.kind === 'exact' || a.kind === 'compound-joined');
  if (!exact.length) return 'FALSE';
  return '(' + exact.map((a) =>
    a.terms.map((t) => `${ti.ref(t)} > 0`).join(' AND ')).join(' OR ') + ')';
}

/** 구문(큰따옴표)은 원문 그대로 들어 있어야 한다. 기관명은 제외 — 구문이 걸릴 자리가 아니다. */
function phraseHitSql(phrase, params) {
  const p = params.add(like(phrase));
  return `(name ILIKE ${p} OR summary ILIKE ${p} OR field ILIKE ${p})`;
}

/**
 * 후보 사전필터.
 *
 * 점수식은 행마다 ILIKE 를 수십 번 평가하므로 전체 행에 돌리면 안 된다.
 * 먼저 "검색어가 하나라도 스치는 행" 만 색인으로 추리고, 점수는 그 소수에만 매긴다.
 * OR 조건이라 어떤 후보도 잘려나가지 않는다 — 엄격검색(AND)은 그 뒤 단계에서 걸러진다.
 */
function prefilterSql(groups, phrases, params) {
  const conds = [];
  for (const g of groups) {
    for (const alt of g.alternatives) {
      for (const t of alt.terms) conds.push(termHitSql(t, params));
    }
  }
  for (const p of phrases) conds.push(phraseHitSql(p, params));
  return conds.length ? `(${conds.join(' OR ')})` : 'TRUE';
}

/**
 * 그룹별 문서빈도(df) 를 한 번의 스캔으로 센다.
 * 그룹 전체(동의어 포함)의 합집합 빈도를 세야 '개념이 얼마나 희귀한가' 를 제대로 반영한다.
 *
 * @returns {number[]} 그룹 순서대로의 df
 */
async function groupDocFrequencies(pool, groups) {
  // 그룹이 없어도(구문만 있는 질의) 코퍼스 크기는 필요하다 — 반환 모양을 항상 같게 유지한다.
  if (!groups.length) {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM gov_program');
    return { total: rows[0].n, dfs: [] };
  }
  const params = new Params();
  const filters = groups.map((g, i) => {
    const anyTerm = g.alternatives
      .map((a) => a.terms.map((t) => termHitSql(t, params)).join(' AND '))
      .join(' OR ');
    return `COUNT(*) FILTER (WHERE ${anyTerm})::int AS df${i}`;
  });
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n, ${filters.join(', ')} FROM gov_program`, params.values);
  return { total: rows[0].n, dfs: groups.map((_, i) => rows[0][`df${i}`]) };
}

/**
 * 희귀도 가중치. 흔한 말은 1 에 가깝고, 희귀한 말일수록 커진다(최대 2 부근).
 * 순수 IDF 를 그대로 곱하면 점수 규모가 널뛰어 등급 정렬을 방해하므로 완만하게 눌렀다.
 */
function idfWeight(df, total) {
  // total 이 1 이면 log(1)=0 으로 나누게 되어 NaN/-Infinity 가 나온다.
  // 그 값이 toFixed 를 거쳐 "NaN" 이라는 맨 토큰으로 SQL 에 박히면 PostgreSQL 이
  // 컬럼명으로 해석해 모든 검색이 500 이 됐다. (2026-08-19 리뷰에서 발견)
  if (!total || total <= 1) return 1;
  const w = 1 + Math.log(total / (1 + df)) / Math.log(total);
  return Number.isFinite(w) ? w : 1;
}

/**
 * 문서빈도 캐시.
 *
 * df 는 코퍼스가 바뀔 때만 변한다(하루 한 번 수집). 그런데 계산에 왕복 한 번과
 * 풀스캔 한 번이 들어가 실측 925ms 가 걸렸다 — 검색마다 낼 비용이 아니다.
 * 같은 말을 다시 검색하면 캐시가 그대로 답한다.
 */
const dfCache = new Map();
const DF_TTL_MS = 10 * 60 * 1000;

/** groupDocFrequencies 의 캐시판. 그룹 구성이 같으면 같은 키가 된다. */
async function cachedGroupDocFrequencies(pool, groups) {
  const key = JSON.stringify(groups.map((g) => g.alternatives.map((a) => a.terms).flat()));
  const hit = dfCache.get(key);
  if (hit && Date.now() - hit.at < DF_TTL_MS) return hit.value;

  const value = await groupDocFrequencies(pool, groups);
  dfCache.set(key, { at: Date.now(), value });
  // 무한정 쌓이지 않게 오래된 것부터 버린다(Map 은 삽입순을 지킨다).
  if (dfCache.size > 500) dfCache.delete(dfCache.keys().next().value);
  return value;
}

module.exports = {
  FIELD_WEIGHTS, Params, TermIndex, like,
  termScoreSql, termHitSql, alternativeScoreSql,
  groupScoreSql, groupExactHitSql, phraseHitSql, prefilterSql,
  groupDocFrequencies, cachedGroupDocFrequencies, idfWeight,
};
