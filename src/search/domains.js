/**
 * 분야 확장 사전.
 *
 * 검색어가 코퍼스에 0건일 때, 그 말이 속한 **분야** 로 넓혀 다시 찾기 위한 것이다.
 *
 * 왜 필요한가.
 *   정부 공고는 품목명으로 쓰이지 않는다. '이끼' 로 검색하면 4,844건 중 0건이다.
 *   그러나 이끼는 선태식물이라 산림 자원화·생태 보전·환경 정화 연구와 닿아 있고,
 *   산림청·환경부 공고 중에 실제로 지원 가능한 것이 있다.
 *   품목을 분야로 옮겨 주지 않으면 사용자는 빈 화면만 본다.
 *
 * 기획서의 '질의확장(Query2doc·CSQE)' 계층이다. 기획서가 못박은 두 가지를 지킨다.
 *   1) "정확 결과가 부족할 때만" — 0건일 때만 발동한다. 결과가 있으면 건드리지 않는다.
 *   2) "LLM 자체 지식만 쓰지 않고, 실제 공고에 존재하는 용어로 확장어를 제한" —
 *      AI 는 분야를 **고르기만** 하고(닫힌 집합), 실제 검색어는 아래 표에서만 나온다.
 *      그래서 AI 가 없는 말을 지어내도 검색에 들어갈 수 없다.
 *
 * ── 어휘를 고른 기준 ──
 *
 * 전부 2026-08-20 에 코퍼스 4,844건을 상대로 직접 세어 검증했다. 괄호 안이 실측 건수다.
 * 한국어는 부분문자열 매칭이 위험해서, 세어 보지 않고 넣으면 반드시 사고가 난다.
 * 실제로 걸러낸 것들:
 *
 *     조경(322)  → 전부 '창조경제혁신센터' 의 창**조경**제
 *     자연(49)   → 전부 '투자연계' 의 투**자연**계
 *     생태(238)  → 237건이 '창업생태계·지역생태계'
 *     정화(22)   → '공정 안정화·밸류체인안정화' 의 안정**화**
 *     소재(1787) → '인천 소재 소상공인' 의 소재(위치)
 *     진단(235)  → '현안 진단·컨설팅 진단'
 *     환경(492)  → 작업환경 47 · 고용환경개선 111 등 — 맨 '환경' 은 못 쓴다
 *
 * 그래서 '환경' 은 환경산업·환경보전·환경오염 같은 복합어로만 넣었다.
 * 너무 흔한 말(400건 초과)도 뺐다 — 확장 결과가 수백 건이면 안 넓힌 것과 같다.
 *
 * ※ scripts/search-regression.js 가 이 표의 모든 어휘에 대해 코퍼스 건수를 검사한다.
 *   공고가 새로 쌓여 어휘가 죽으면 테스트가 먼저 알려 준다.
 */

const DOMAINS = {
  forestry: {
    label: '산림·임업',
    terms: ['산림', '임업', '임산물', '산촌', '목재'],          // 17·13·3·2·1
    agencies: ['산림청', '임업진흥원'],                          // 5건
  },
  environment: {
    label: '환경·생태',
    terms: ['환경산업', '환경보전', '환경오염', '폐기물', '자원순환', '재활용', '수질', '대기오염'],
    agencies: ['환경부', '한국환경공단', '환경산업기술원'],       // 43건
  },
  climate: {
    label: '기후·탄소',
    terms: ['탄소중립', '온실가스', '기후변화', '신재생', '재생에너지'],
    agencies: [],
  },
  agriculture: {
    label: '농업·농촌',
    terms: ['농업', '농촌', '농식품', '귀농', '원예', '스마트팜', '축산'],
    agencies: ['농림축산식품부', '농업기술원', '농업기술센터'],
  },
  marine: {
    label: '수산·해양',
    terms: ['수산', '해양', '어업', '양식'],
    agencies: ['해양수산부'],
  },
  bio: {
    label: '바이오·의료',
    terms: ['바이오', '의료기기', '제약', '헬스케어', '디지털헬스'],
    agencies: [],
  },
  food: {
    label: '식품',
    terms: ['식품', '가공식품', '건강기능', '발효'],
    agencies: [],
  },
  materials: {
    label: '소재·부품·화학',
    terms: ['소재부품', '부품', '화학', '금속', '뿌리기업'],
    agencies: [],
  },
  textile: {
    label: '섬유·패션·뷰티',
    terms: ['섬유', '패션', '화장품'],
    agencies: [],
  },
  ict: {
    label: 'ICT·소프트웨어',
    terms: ['소프트웨어', '인공지능', '정보통신', '데이터', '플랫폼'],
    agencies: [],
  },
  manufacturing: {
    label: '제조·자동화',
    terms: ['로봇', '자동화', '스마트공장'],
    agencies: [],
  },
  energy: {
    label: '에너지',
    terms: ['에너지', '배터리', '수소', '전력'],
    agencies: [],
  },
  electronics: {
    label: '전자·반도체',
    terms: ['반도체', '디스플레이'],
    agencies: [],
  },
  mobility: {
    label: '자동차·조선·항공우주',
    terms: ['자동차부품', '조선', '우주', '방산'],
    agencies: [],
  },
  culture: {
    label: '문화·관광·콘텐츠',
    terms: ['관광', '문화예술', '공예', '콘텐츠'],
    agencies: [],
  },
  construction: {
    label: '건설·건축',
    terms: ['건설', '건축', '인테리어'],
    agencies: [],
  },
  logistics: {
    label: '물류·유통',
    terms: ['물류', '유통', '이커머스'],
    agencies: [],
  },
};

/**
 * 품목 → 분야 사전.
 *
 * 품목은 무한하므로 전부 적을 수는 없다. 모르는 말은 AI 가 분야를 고른다.
 * 다만 **AI 없이도 쓸 만해야 한다** — 2026-08-20 현재 Gemini 키의 크레딧이 소진되어
 * AI 경로가 아예 못 돈다. 그동안은 이 표가 기능 전부를 떠받친다.
 * 회귀 테스트도 AI 호출 없이 이 표로 돈다.
 */
const SEED_HINTS = {
  // 산림·임업
  이끼: ['forestry', 'environment'], 선태식물: ['forestry', 'environment'],
  선태류: ['forestry', 'environment'], 버섯: ['forestry', 'agriculture'],
  표고: ['forestry', 'agriculture'], 약초: ['forestry', 'agriculture'],
  산나물: ['forestry', 'agriculture'], 원목: ['forestry', 'materials'],
  펠릿: ['forestry', 'energy'], 고로쇠: ['forestry', 'food'],
  편백: ['forestry', 'environment'], 분재: ['forestry', 'agriculture'],
  조경수: ['forestry', 'agriculture'], 산양삼: ['forestry', 'agriculture'],

  // 환경·생태
  오폐수: ['environment'], 폐수: ['environment'], 분뇨: ['environment', 'agriculture'],
  축분: ['environment', 'agriculture'], 하수: ['environment'], 슬러지: ['environment'],
  미세먼지: ['environment', 'climate'], 악취: ['environment'], 매립: ['environment'],
  소각: ['environment'], 업사이클: ['environment', 'textile'],
  폐플라스틱: ['environment', 'materials'], 폐배터리: ['environment', 'energy'],

  // 기후·탄소
  탄소포집: ['climate', 'environment'], 배출권: ['climate'],
  태양광: ['climate', 'energy'], 풍력: ['climate', 'energy'], 지열: ['climate', 'energy'],

  // 농업·농촌
  곤충: ['agriculture', 'bio'], 양봉: ['agriculture', 'food'], 벌꿀: ['agriculture', 'food'],
  인삼: ['agriculture', 'food'], 화훼: ['agriculture', 'forestry'],
  육묘: ['agriculture'], 종묘: ['agriculture'], 농기계: ['agriculture', 'manufacturing'],
  한우: ['agriculture', 'food'], 양돈: ['agriculture', 'food'], 낙농: ['agriculture', 'food'],

  // 수산·해양
  해조류: ['marine', 'food'], 미역: ['marine', 'food'], 다시마: ['marine', 'food'],
  전복: ['marine', 'food'], 굴: ['marine', 'food'], 해파리: ['marine', 'environment'],
  양식장: ['marine'], 어선: ['marine', 'mobility'], 해양바이오: ['marine', 'bio'],

  // 바이오·의료
  효소: ['bio', 'food'], 미생물: ['bio', 'environment'], 배양: ['bio'],
  백신: ['bio'], 항체: ['bio'], 진단키트: ['bio'], 줄기세포: ['bio'],
  임플란트: ['bio', 'materials'], 재활기기: ['bio'],

  // 식품
  미네랄: ['food', 'bio'], 발효식품: ['food', 'bio'], 장류: ['food'],
  떡볶이: ['food'], 김치: ['food', 'agriculture'], 대체육: ['food', 'bio'],
  베이커리: ['food'], 커피: ['food'], 즉석식품: ['food'],

  // 소재·부품·화학
  촉매: ['materials'], 도금: ['materials'], 주조: ['materials'], 금형: ['materials'],
  열처리: ['materials'], 용접: ['materials'], 세라믹: ['materials'],
  탄소섬유: ['materials', 'textile'], 접착제: ['materials'],

  // 섬유·패션·뷰티
  원단: ['textile'], 니트: ['textile'], 봉제: ['textile'], 가죽: ['textile'],
  신발: ['textile'], 쥬얼리: ['textile', 'culture'], 스킨케어: ['textile', 'bio'],

  // ICT·소프트웨어
  챗봇: ['ict'], 클라우드: ['ict'], 블록체인: ['ict'], 메타버스: ['ict', 'culture'],
  게임: ['ict', 'culture'], 사물인터넷: ['ict', 'electronics'], 보안솔루션: ['ict'],

  // 제조·자동화
  사출: ['manufacturing', 'materials'], 공작기계: ['manufacturing'],
  협동로봇: ['manufacturing'], 물류로봇: ['manufacturing', 'logistics'],

  // 에너지·전자·모빌리티
  연료전지: ['energy'], 전기차충전기: ['energy', 'mobility'], 이차전지: ['energy', 'electronics'],
  센서: ['electronics'], 드론: ['mobility', 'ict'], 자율주행: ['mobility', 'ict'],
  전장부품: ['mobility', 'electronics'], 선박기자재: ['mobility', 'materials'],

  // 문화·건설·물류
  웹툰: ['culture'], 애니메이션: ['culture'], 도자기: ['culture'], 한복: ['culture', 'textile'],
  캐릭터: ['culture'], 모듈러: ['construction'], 단열재: ['construction', 'materials'],
  창호: ['construction'], 리모델링: ['construction'],
  콜드체인: ['logistics', 'food'], 풀필먼트: ['logistics'], 역직구: ['logistics'],
};

// 합성어를 위한 부분일치용 — '고려인삼' 은 '인삼', '스마트양식장' 은 '양식장' 으로 잡는다.
// 짧은 말은 엉뚱하게 걸리므로(예: '김' 이 '김밥·김포' 에) 두 글자 이상만 쓴다.
const SEED_KEYS_BY_LENGTH = Object.keys(SEED_HINTS)
  .filter((k) => k.length >= 2)
  .sort((a, b) => b.length - a.length);

/**
 * 품목 하나를 분야 키 배열로. 정확히 없으면 합성어 안에서 찾아본다.
 *
 * ⚠ 반드시 자기 속성만 본다. 그냥 `SEED_HINTS[term]` 로 읽으면 프로토타입 체인이
 * 딸려 나와서, 사용자가 'constructor'·'toString'·'valueOf' 를 검색하면 배열이 아닌
 * 함수가 돌아오고 그 뒤 .slice() 에서 터진다. 실제로 /api/programs/search?q=constructor
 * 가 HTTP 500 이었다. (2026-08-20 리뷰에서 발견)
 */
function seedLookup(term) {
  const own = (k) => Object.prototype.hasOwnProperty.call(SEED_HINTS, k);
  if (own(term)) return SEED_HINTS[term];
  for (const k of SEED_KEYS_BY_LENGTH) {
    if (term.length > k.length && term.includes(k)) return SEED_HINTS[k];
  }
  return null;
}

const DOMAIN_KEYS = Object.keys(DOMAINS);

/** 분야 하나가 검색에 쓸 말 전부 (주제어 + 소관기관). */
function domainTerms(key) {
  const d = DOMAINS[key];
  if (!d) return [];
  return [...d.terms, ...d.agencies];
}

// ── AI 분류 ────────────────────────────────────────────────────────────

const { getModel, generateWithTimeout } = require('../gemini');

const AI_TIMEOUT_MS = 3000;

let _model;
function geminiModel() {
  if (_model === undefined) _model = getModel();
  return _model;
}

/**
 * 실패 사유별로 한 번씩만 경고한다.
 *
 * 예전에는 불린 하나로 잠갔는데, 그러면 부팅 직후의 일시적 503 하나가 그 뒤의
 * 모든 실패를 영구히 침묵시킨다. 몇 주 뒤 모델이 은퇴해도 로그가 안 남는다 —
 * 이 기능이 고치려던 바로 그 '조용한 죽음' 이 되돌아온다.
 */
const _warned = new Set();
function warnOnce(err) {
  const sig = String(err && err.message || err).replace(/\d{3,}/g, '#').slice(0, 80);
  if (_warned.has(sig)) return;
  if (_warned.size > 20) _warned.clear();
  _warned.add(sig);
  console.warn(`[search] 분야 확장 AI 호출 실패 — 사전에 있는 말만 확장됩니다: ${String(err && err.message || err).slice(0, 160)}`);
}

// 같은 말을 두 번 묻지 않는다. 0건 검색은 드물지만 같은 말이 반복되는 경향이 있다.
//
// '확장할 분야 없음'(null)도 반드시 캐시되어야 한다. 안 그러면 사전에 없는 말이
// 들어올 때마다 AI 를 다시 부른다. 그래서 '없음' 과 '캐시에 없음' 을 값으로 구분하지 않고
// has() 로 가른다 — 예전 코드는 둘 다 null 이라 부정 캐시가 통째로 죽어 있었다.
const _cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MISS = Symbol('cache-miss');

function cacheGet(k) {
  if (!_cache.has(k)) return MISS;
  const hit = _cache.get(k);
  if (Date.now() - hit.at > CACHE_TTL_MS) { _cache.delete(k); return MISS; }
  return hit.val;
}
function cacheSet(k, val) {
  // 통째로 비우면 자주 쓰이는 항목까지 같이 날아간다. 오래된 것부터 하나씩 버린다.
  // (Map 은 삽입 순서를 지킨다 — rank.js 의 dfCache 와 같은 방식)
  if (_cache.size > 500) _cache.delete(_cache.keys().next().value);
  _cache.set(k, { at: Date.now(), val });
}

/**
 * AI 에게 분야를 **고르게만** 한다.
 *
 * 자유 생성이 아니라 닫힌 집합에서의 선택이라, 없는 말을 지어내도 통과할 수 없다.
 * 돌아온 키가 DOMAINS 에 없으면 버린다.
 */
async function classifyWithAI(terms) {
  const model = geminiModel();
  if (!model) return null;

  // 검색어 전부를 넘긴다. 첫 낱말만 주면 '스마트 해조류' 가 '스마트' 로 분류된다.
  const phrase = terms.slice(0, 6).join(' ');
  const list = DOMAIN_KEYS.map((k) => `- ${k}: ${DOMAINS[k].label}`).join('\n');
  const prompt = [
    '너는 한국 정부지원사업 공고 검색을 돕는 분류기다.',
    `사용자가 "${phrase}" 으로 공고를 검색했는데 이 말이 들어간 공고가 하나도 없다.`,
    `"${phrase}" 이 산업·기술적으로 관련된 분야를 아래 목록에서 최대 2개 고르라.`,
    '관련 분야가 뚜렷하지 않으면 빈 배열을 반환하라. 억지로 고르지 마라.',
    '',
    '분야 목록:',
    list,
    '',
    'JSON 만 출력한다. 다른 말은 쓰지 마라.',
    '{"domains":["키","키"],"reason":"왜 관련되는지 한 문장(한국어)"}',
  ].join('\n');

  const res = await generateWithTimeout(model, prompt, AI_TIMEOUT_MS);
  const text = String(res.response.text() || '');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;

  const parsed = JSON.parse(m[0]);
  const keys = (Array.isArray(parsed.domains) ? parsed.domains : [])
    .filter((k) => DOMAIN_KEYS.includes(k))   // 지어낸 키는 여기서 죽는다
    .slice(0, 2);
  if (!keys.length) return null;

  return { keys, reason: String(parsed.reason || '').slice(0, 200) };
}

/**
 * 검색어를 분야로 옮긴다.
 *
 * @param {string[]} terms  질의계획이 뽑은 핵심어들
 * @returns {Promise<null | {keys:string[], labels:string[], terms:string[], reason:string, source:'seed'|'ai'}>}
 */
async function expandToDomains(terms) {
  const list = (terms || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (!list.length) return null;

  const key = list.join('|').toLowerCase();
  const cached = cacheGet(key);
  if (cached !== MISS) return cached;

  let found = null;

  // 1) 사전에 적힌 말이면 AI 를 부르지 않는다.
  for (const t of list) {
    const seed = seedLookup(t);
    if (seed) { found = { keys: seed.slice(0, 2), reason: '', source: 'seed' }; break; }
  }

  // 2) 모르는 말은 AI 에게 분야만 고르게 한다.
  if (!found) {
    try {
      const ai = await classifyWithAI(list);
      if (ai) found = { keys: ai.keys, reason: ai.reason, source: 'ai' };
    } catch (e) {
      // AI 가 죽어도 검색은 죽으면 안 된다. 확장 없이 0건으로 돌아간다.
      warnOnce(e);
      found = null;
    }
  }

  if (!found) { cacheSet(key, null); return null; }

  const result = {
    keys: found.keys,
    labels: found.keys.map((k) => DOMAINS[k].label),
    terms: pickTerms(found.keys),
    reason: found.reason,
    source: found.source,
  };
  cacheSet(key, result);
  return result;
}

/**
 * 실제로 검색에 쓸 확장어를 고른다.
 *
 * 개수를 제한해야 한다. 확장어 하나가 곧 4,844행 전부를 훑는 LIKE 하나여서,
 * 분야 둘을 합치면 18개까지 늘어 2.2초를 넘겼다(2026-08-20 실측).
 *
 * 자르는 방식이 중요하다. 분야를 이어 붙인 뒤 앞에서 자르면 뒤쪽 분야가 통째로
 * 날아간다 — '이끼'(산림+환경)에서 환경 쪽 주제어 8개 중 6개가 잘려, 환경 분야는
 * 기관명만 남고 결과가 산림 일색이 됐다. 그래서 분야를 번갈아 가며 뽑는다.
 *
 * 소관 기관을 먼저 넣는다. '산림청' 이 낸 공고는 거의 다 산림 관련이라
 * 주제어보다 정확하다.
 */
const MAX_TERMS = 12;

function pickTerms(keys) {
  const queues = keys.map((k) => {
    const d = DOMAINS[k];
    return d ? [...d.agencies, ...d.terms] : [];
  });
  const out = [];
  for (let i = 0; out.length < MAX_TERMS; i++) {
    let moved = false;
    for (const q of queues) {
      if (i >= q.length) continue;
      moved = true;
      if (!out.includes(q[i])) out.push(q[i]);
      if (out.length >= MAX_TERMS) break;
    }
    if (!moved) break;   // 모든 분야를 다 소진했다
  }
  return out;
}

module.exports = { DOMAINS, DOMAIN_KEYS, SEED_HINTS, domainTerms, expandToDomains };
