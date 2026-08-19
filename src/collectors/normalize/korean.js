/**
 * 공고 원문(한국어) → gov_program canonical 스키마 변환기.
 *
 * Public Compass 는 범용 '문서'를 다루므로 이 계층이 없다. 우리는 매칭 엔진이
 * target_stages / target_segments / max_amount 를 그대로 쓰기 때문에, 공고 텍스트에서
 * 그 값들을 뽑아내는 것이 수집의 실질적인 핵심이다.
 *
 * 모든 함수는 순수 함수다(입력 문자열만 보고 판단, DB·네트워크 접근 없음).
 * → scripts/test-normalize.js 로 단독 검증 가능.
 */

// ── 지원금액 ──
// "최대 1억원", "5,000만원", "1억 5천만원", "3천만원" 등 공고문에 흔한 표기를 원 단위로.
function parseAmount(text) {
  if (!text) return null;
  const t = String(text).replace(/[\s,]/g, '');

  let total = 0;
  let matched = false;

  const eok = t.match(/(\d+(?:\.\d+)?)억/);
  if (eok) { total += parseFloat(eok[1]) * 1e8; matched = true; }

  const cheonman = t.match(/(\d+(?:\.\d+)?)천만/);
  if (cheonman) { total += parseFloat(cheonman[1]) * 1e7; matched = true; }

  const baekman = t.match(/(\d+(?:\.\d+)?)백만/);
  if (baekman) { total += parseFloat(baekman[1]) * 1e6; matched = true; }

  // '천만'·'백만'을 이미 잡았으면 그 안의 '만'을 중복 계산하지 않는다.
  if (!cheonman && !baekman) {
    const man = t.match(/(\d+(?:\.\d+)?)만/);
    if (man) { total += parseFloat(man[1]) * 1e4; matched = true; }
  }

  // 단위어 없이 "50000000원" 처럼 적힌 경우
  if (!matched) {
    const won = t.match(/(\d{5,})원/);
    if (won) { total = parseInt(won[1], 10); matched = true; }
  }

  return matched ? Math.round(total) : null;
}

// ── 업력(stage) ──
// gov_program.target_stages 가 쓰는 값: 예비 / 1년미만 / 1-3년 / 3-7년 / 소상공인
function inferStages(text) {
  const t = text || '';
  const out = new Set();

  if (/예비\s*창업|창업\s*예정|사업자등록\s*전|아이디어\s*단계/.test(t)) out.add('예비');
  if (/소상공인|자영업|점포|상인/.test(t)) out.add('소상공인');

  // "창업 3년 이내" 류 — 숫자를 읽어 해당 구간을 모두 채운다.
  const within = t.match(/창업\s*(?:후\s*)?(\d)\s*년\s*(?:이내|미만)/);
  if (within) {
    const y = parseInt(within[1], 10);
    if (y >= 1) out.add('1년미만');
    if (y >= 2) out.add('1-3년');
    if (y >= 4) out.add('3-7년');
    // 3년 이내 공고는 예비창업자도 받는 경우가 많다
    if (y <= 3 && /예비/.test(t)) out.add('예비');
  }
  if (/초기\s*창업/.test(t)) { out.add('1년미만'); out.add('1-3년'); }
  if (/도약|스케일업|성장\s*단계/.test(t)) { out.add('3-7년'); out.add('1-3년'); }
  if (/7\s*년\s*(?:이내|미만)/.test(t)) { out.add('1년미만'); out.add('1-3년'); out.add('3-7년'); }

  return [...out];
}

// ── 세그먼트 ──
// segment_master 코드: PRE EARLY SMB YOUTH SENIOR WORKER WOMAN LOAN RND
function inferSegments(text) {
  const t = text || '';
  const out = new Set();

  if (/예비\s*창업|창업\s*예정|아이디어\s*단계/.test(t)) out.add('PRE');
  if (/초기\s*창업|창업\s*[1-3]\s*년|기창업/.test(t)) out.add('EARLY');
  if (/소상공인|자영업|점포|전통시장/.test(t)) out.add('SMB');
  if (/청년|만\s*39\s*세|39세\s*이하|20~39/.test(t)) out.add('YOUTH');
  if (/중장년|시니어|만\s*40\s*세\s*이상|4060|퇴직/.test(t)) out.add('SENIOR');
  if (/재직자|직장인|부업|퇴사\s*예정/.test(t)) out.add('WORKER');
  if (/여성/.test(t)) out.add('WOMAN');
  if (/융자|대출|보증|정책자금|운전자금|시설자금/.test(t)) out.add('LOAN');
  if (/R\s*&\s*D|연구개발|기술개발|과제\s*수행/i.test(t)) out.add('RND');

  return [...out];
}

// ── 지역 ──
const REGIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

function inferRegion(text) {
  const t = text || '';
  if (/전국|전\s*지역/.test(t)) return '전국';
  for (const r of REGIONS) {
    // "서울특별시", "경기도", "경남" 모두 접두 일치로 잡힌다
    if (new RegExp(`${r}(특별시|광역시|특별자치시|특별자치도|도)?`).test(t)) return r;
  }
  return '전국'; // 판단 불가 시 매칭에서 배제되지 않도록 보수적으로 전국
}

// ── 지원 유형 ──
// 순서가 곧 우선순위다. '보증'을 '융자'보다 먼저 두는 이유: 보증 공고는 본문에서
// 대출을 반드시 언급하지만, 융자 공고가 보증을 언급하는 경우는 드물다.
// '사업화'가 '컨설팅'보다 앞: 사업화 지원사업은 멘토링·교육을 부가로 끼워 파는 것이
// 보통이라, 본문의 '멘토링' 한 단어에 유형이 끌려가면 안 된다.
const TYPE_RULES = [
  ['보증', /보증/],
  ['융자', /융자|대출|정책자금|운전자금|시설자금/],
  ['공제', /공제/],
  ['R&D', /R\s*&\s*D|연구개발|기술개발|신규과제/i],
  ['디지털전환', /디지털\s*전환|스마트|키오스크|POS/i],
  ['사업화', /사업화|시제품|창업\s*패키지|입교|보육|창업\s*(?:을|를)?\s*지원/],
  ['컨설팅', /컨설팅|멘토링|교육|바우처/],
];

/**
 * 제목에서 먼저 찾고, 없을 때만 본문을 본다.
 * 공고 제목은 담당자가 유형을 압축해 적은 것이라 본문보다 신호가 정확하다.
 */
function inferFundingType(blob, title = '') {
  for (const [type, re] of TYPE_RULES) if (title && re.test(title)) return type;
  for (const [type, re] of TYPE_RULES) if (re.test(blob || '')) return type;
  return '기타';
}

// ── 날짜 ──
// "20260815", "2026-08-15", "2026.08.15", "2026년 8월 15일" 을 모두 받는다.
function parseDate(value) {
  if (!value) return null;
  const s = String(value).trim();

  let m = s.match(/^(\d{4})[-.\/]?(\d{2})[-.\/]?(\d{2})/);
  if (!m) m = s.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!m) return null;

  const [, y, mo, d] = m;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? null : iso;
}

/**
 * "접수기간: 2026.08.17 ~ 2026.08.31" 같은 기간 표기를 시작/종료로 쪼갠다.
 * 라벨(접수기간/신청기간/모집기간)이 붙어 있어도, 날짜만 있어도 동작한다.
 */
function parsePeriodRange(text) {
  if (!text) return { start: null, end: null };
  const s = String(text);

  // 라벨이 있으면 그 줄만 잘라 본다 — 본문 다른 곳의 날짜에 오염되지 않도록
  const labeled = s.match(/(?:접수|신청|모집)\s*기간\s*[:：]?\s*([^\n]{0,60})/);
  const target = labeled ? labeled[1] : s;

  const dates = target.match(/\d{4}\s*[-.\/년]\s*\d{1,2}\s*[-.\/월]\s*\d{1,2}|\d{8}/g);
  if (!dates || !dates.length) return { start: null, end: null };

  return {
    start: parseDate(dates[0]),
    end: dates.length > 1 ? parseDate(dates[1]) : null,
  };
}

/**
 * 본문에서 "지원대상: …", "지원분야: …" 같은 라벨 줄만 뽑아낸다.
 *
 * 본문 전체를 키워드 매칭에 넣으면 오분류가 심하다. 실례로 김제시 사회적경제
 * 판로지원사업은 지원 가능 비용 목록에 '기술개발비'가 한 번 등장한다는 이유로
 * 공고 전체가 R&D 로 분류됐다. 라벨 줄은 담당자가 요약해 적은 값이라 신호가 훨씬 정확하다.
 */
function extractLabeledField(text, label) {
  if (!text) return '';
  const m = String(text).match(new RegExp(`${label}\\s*[:：]\\s*([^\\n]{0,200})`));
  return m ? m[1].trim() : '';
}

/** 분류에 쓸 만한 라벨 줄을 모아 한 덩어리로 돌려준다. */
function extractStructuredHints(body) {
  if (!body) return '';
  return ['지원대상', '지원분야', '신청자격', '지원내용']
    .map((l) => extractLabeledField(body, l))
    .filter(Boolean)
    .join(' ');
}

// ── 주관기관 추정 ──
// OneGov 는 출처를 특정하지 못한 공고에 '정부 공통(집계)' 라는 자리표시자를 넣는다.
// 그대로 화면에 내보내면 사용자에게 아무 의미가 없어, 제목·본문에서 실제 기관을 되찾는다.
const SIDO_FULL = {
  서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시',
  광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시',
  경기: '경기도', 강원: '강원특별자치도', 충북: '충청북도', 충남: '충청남도',
  전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도',
  제주: '제주특별자치도',
};

const ORG_SUFFIX = '협회|진흥원|공단|재단|센터|조합|기술원|연구원|대학교|진흥회|공사|산업원|청';

function inferAgency({ title = '', summary = '', fallback = '' }) {
  // 1) "[경기] 용인시 2026년 …" 처럼 제목이 기초지자체를 밝히는 경우가 가장 정확하다
  const local = title.match(/^\[[^\]]+\]\s*([가-힣]{2,10}(?:시|군|구))\s/);
  if (local) return local[1];

  // 2) "(사)한국중소기업발전협회의 …", "○○진흥원에서 …"
  const org = summary.match(
    new RegExp(`^((?:\\((?:사|재|주|복)\\))?\\s*[가-힣A-Za-z0-9]{2,25}(?:${ORG_SUFFIX}))(?:의|에서|은|는)\\s`),
  );
  if (org) return org[1].trim();

  // 3) 제목 앞 "[경북]" 만 있으면 해당 광역지자체 공고로 본다
  const sido = title.match(/^\[([가-힣]{2})\]/);
  if (sido && SIDO_FULL[sido[1]]) return SIDO_FULL[sido[1]];

  return fallback;
}

// ── 태그 ──
const TAG_RULES = [
  [/예비\s*창업/, '예비창업'], [/청년/, '청년'], [/여성/, '여성'],
  [/중장년|시니어|퇴직/, '중장년'], [/소상공인|자영업/, '소상공인'],
  [/사업화|시제품|창업\s*패키지|보육/, '사업화'], [/멘토링|컨설팅/, '멘토링'],
  [/융자|대출|정책자금/, '융자'], [/보증/, '보증'], [/R\s*&\s*D|기술개발|연구개발/i, 'R&D'],
  [/디지털|스마트|키오스크/, '디지털전환'], [/수출|해외/, '수출'], [/제조/, '제조'],
  [/입주|공간|센터/, '공간'],
];

function extractTags(text) {
  const t = text || '';
  return TAG_RULES.filter(([re]) => re.test(t)).map(([, tag]) => tag);
}

/**
 * 공고 텍스트 뭉치를 받아 gov_program 컬럼 일부를 한 번에 채운다.
 * 수집기별 normalize.js 가 필드 매핑만 하고 판단은 여기에 위임하도록 한 것.
 */
function deriveClassification({ title = '', summary = '', extra = '' }) {
  const blob = [title, summary, extra].filter(Boolean).join(' ');

  let stages = inferStages(blob);
  const segments = inferSegments(blob);

  // ── 매칭 탈락 방지 보정 ──
  // server.js:401 은 target_segments 와 target_stages 가 모두 비면 공고를 하드필터에서
  // 탈락시킨다. 그런데 지자체·유관기관 공고는 "참여기업 모집" 형태로만 적혀 있어
  // 업력·세그먼트가 하나도 안 잡히는 경우가 흔하다(실측 35건 중 24건).
  // 그대로 두면 수집해도 사용자에게 영원히 노출되지 않는다.
  //
  // 따라서 '사업자 대상'인 것이 분명하면 운영 중인 사업자 전 구간을 기본값으로 넣는다.
  // 예비창업자는 넣지 않는다 — 사업자등록이 없으면 '참여기업'이 될 수 없기 때문이다.
  if (!stages.length && !segments.length && /기업|사업자|소상공인|중소기업|자영업/.test(blob)) {
    stages = ['1년미만', '1-3년', '3-7년', '소상공인'];
  }

  return {
    target_stages: stages,
    target_segments: segments,
    region: inferRegion(blob),
    funding_type: inferFundingType(blob, title),
    normalized_tags: extractTags(blob),
  };
}

module.exports = {
  parseAmount,
  inferStages,
  inferSegments,
  inferRegion,
  inferFundingType,
  parseDate,
  parsePeriodRange,
  inferAgency,
  extractLabeledField,
  extractStructuredHints,
  extractTags,
  deriveClassification,
};
