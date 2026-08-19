/**
 * 질의계획기 (Query Planner).
 *
 * 기획서 2장의 핵심 요구를 구현한다 — "모든 토큰을 한 줄로 OR 결합하지 말고,
 * 핵심어와 일반어를 나눈 뒤 동의어 그룹 안만 OR, 그룹 사이는 AND 로 묶어라."
 *
 * 입력  : 사용자가 친 검색어 한 줄
 * 출력  : 아래 planQuery 의 반환 구조 (검색 실행기와 UI 가 함께 쓴다)
 *
 * 형태소 분석기(Kiwi·Mecab)는 아직 붙이지 않았다. 대신 조사·어미를 규칙으로 떼어내는데,
 * 우리 검색이 substring(ILIKE) 기반이라 어간만 남겨도 원형을 포함한 문서가 그대로 잡힌다.
 * 분석기 도입은 정확도 이득과 운영 비용을 재 본 뒤 결정할 일이다.
 */
const dict = require('./dictionary');

// 기획서 3장 '권장 가중치 예시' 를 그대로 옮긴 값.
const WEIGHT = {
  phrase:   1.00,   // 원문 정확구문
  exact:    0.90,   // 입력한 말 그대로
  synonym:  0.75,   // 승인된 동의어
  compound: 0.45,   // 구성명사 조합
  generic:  0.10,   // 일반어 단독
};

// 떼어낼 조사·어미. 긴 것부터 봐야 '에서' 가 '서' 로 잘못 잘리지 않는다.
const PARTICLES = [
  '으로서', '으로써', '에서는', '에게서', '이라는', '라는',
  '에서', '에게', '으로', '까지', '부터', '보다', '처럼', '만큼', '조차', '마저',
  '이나', '이란', '라도', '이든', '한테',
  '을', '를', '이', '가', '은', '는', '의', '에', '와', '과', '도', '만', '로', '랑',
];
// 관형형·연결형 어미 — '이용한', '활용하는', '적용된' 같은 꼴을 어간으로 되돌린다.
const ENDINGS = ['하는', '되는', '시키는', '하기', '되기', '한', '된', '할', '될', '해', '돼'];

/** 조사·어미 제거. 너무 짧아지면(1글자) 원형을 그대로 둔다 — '판로'→'판' 같은 사고 방지. */
function stripParticles(token) {
  if (token.length < 3) return token;
  for (const list of [ENDINGS, PARTICLES]) {
    for (const suf of list) {
      if (token.length - suf.length >= 2 && token.endsWith(suf)) {
        return token.slice(0, -suf.length);
      }
    }
  }
  return token;
}

/** 큰따옴표로 감싼 구간을 구문으로 떼어내고, 나머지 문자열을 돌려준다. */
function extractPhrases(text) {
  const phrases = [];
  const rest = text.replace(/"([^"]{2,60})"/g, (_, p) => {
    const v = p.trim();
    if (v) phrases.push(v);
    return ' ';
  });
  return { phrases, rest };
}

/**
 * 검색어 한 줄을 검색 실행 계획으로 바꾼다.
 *
 * @param {string} raw 사용자 입력
 * @returns {{
 *   original: string, normalized: string,
 *   corrections: Array<{from: string, to: string}>,
 *   phrases: string[],
 *   groups: Array<{primary: string, alternatives: Array<{terms: string[], weight: number, kind: string}>}>,
 *   generic: string[], intent: string[], warnings: string[]
 * }}
 */
function planQuery(raw) {
  const original = String(raw || '').trim();
  const corrections = [];
  const warnings = [];

  // 1) 표기 정규화 — 가운뎃점·전각문자·중복공백 정리
  let text = dict.normalizeText(original);

  // 2) 오타·표기변형 교정 (긴 표현부터 치환해야 부분 치환 사고가 없다)
  for (const [from, to] of [...dict.SPELLING_FIXES].sort((a, b) => b[0].length - a[0].length)) {
    if (text.includes(from)) {
      text = text.split(from).join(to);
      corrections.push({ from, to });
    }
  }
  const normalized = text;

  // 3) 정확구문 분리
  const { phrases, rest } = extractPhrases(text);

  // 4) 토큰화 + 조사·어미 제거
  const rawTokens = rest.split(/\s+/).filter(Boolean).slice(0, 8);
  const tokens = [];
  for (const t of rawTokens) {
    const stem = stripParticles(t);
    if (stem.length >= 1 && !tokens.includes(stem)) tokens.push(stem);
  }

  // 5) 핵심어 / 일반어 / 의도어 분류
  const groups = [];
  const generic = [];
  const intent = [];

  for (const t of tokens) {
    if (dict.isIntent(t)) { intent.push(t); continue; }   // '지원'·'모집' 은 내용어가 아니다
    if (dict.isGeneric(t)) { generic.push(t); continue; }
    if (t.length < 2 && !/^[A-Za-z0-9]+$/.test(t)) { generic.push(t); continue; }

    // 같은 그룹에 속한 말을 두 번 치면(예: 'AI 인공지능') 그룹을 하나로 합친다
    const syns = dict.synonymsOf(t);
    const dup = groups.find((g) => g.alternatives.some((a) =>
      a.terms.length === 1 && syns.some((s) => s.toLowerCase() === a.terms[0].toLowerCase())));
    if (dup) continue;

    const alternatives = [{ terms: [t], weight: WEIGHT.exact, kind: 'exact' }];
    for (const s of syns) {
      if (s.toLowerCase() === t.toLowerCase()) continue;
      alternatives.push({ terms: [s], weight: WEIGHT.synonym, kind: 'synonym' });
    }
    const parts = dict.decompose(t);
    if (parts) alternatives.push({ terms: parts, weight: WEIGHT.compound, kind: 'compound' });

    groups.push({ primary: t, alternatives });
  }

  // 6) 붙여 쓴 복합어를 띄어 쓴 경우 보정 — '창업 보육' 두 토큰이 사전의 '창업보육' 이면
  //    붙여 쓴 형태도 함께 찾도록 각 그룹에 대안을 얹는다(전체형이 정밀도가 높다).
  for (let i = 0; i < groups.length - 1; i++) {
    const joined = groups[i].primary + groups[i + 1].primary;
    if (dict.COMPOUND_PARTS.has(joined) || dict.synonymsOf(joined).length > 1) {
      groups[i].alternatives.push({ terms: [joined], weight: WEIGHT.phrase, kind: 'compound-joined' });
    }
  }

  // 7) 경고 — 핵심어가 하나도 없으면 검색이 의미를 잃는다
  if (!groups.length && !phrases.length) {
    if (generic.length || intent.length) {
      warnings.push('일반적인 단어만 입력하셨습니다. 기술·업종·지원분야 같은 구체적인 말을 넣어보세요.');
    }
  }

  return { original, normalized, corrections, phrases, groups, generic, intent, warnings };
}

module.exports = { planQuery, stripParticles, WEIGHT };
