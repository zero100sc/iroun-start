/**
 * 순수 함수 단위 테스트 — DB 없이 즉시 돈다.
 *
 *   npm test
 *
 * 여기 있는 항목은 전부 2026-08-19 코드 리뷰에서 실제로 발견된 버그다.
 * 하나하나가 "이렇게 깨졌었다" 는 기록이니 지우지 말 것.
 * DB 가 필요한 검색 품질 검증은 scripts/search-regression.js 에 따로 있다.
 */
const { parseDate, parsePeriodRange } = require('../src/collectors/normalize/korean');
const { normalizeText } = require('../src/search/dictionary');
const { idfWeight } = require('../src/search/rank');
const { planQuery } = require('../src/search/query-plan');

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) console.log(`       기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`);
};

console.log('── parseDate (한 자리 월/일) ──');
t("'2026.8.15'",   parseDate('2026.8.15'),   '2026-08-15');
t("'2026-8-5'",    parseDate('2026-8-5'),    '2026-08-05');
t("'2026.08.15'",  parseDate('2026.08.15'),  '2026-08-15');
t("'20260815'",    parseDate('20260815'),    '2026-08-15');
t("'2026년 8월 1일'", parseDate('2026년 8월 1일'), '2026-08-01');
t("존재하지 않는 날짜 '2026-02-30'", parseDate('2026-02-30'), null);
t("월 범위 초과 '2026-13-01'",       parseDate('2026-13-01'), null);
t("빈값",                            parseDate(''),           null);

console.log('\n── parsePeriodRange ──');
t("'접수기간: 2026.8.1 ~ 2026.8.31'",
  parsePeriodRange('접수기간: 2026.8.1 ~ 2026.8.31'),
  { start: '2026-08-01', end: '2026-08-31' });

console.log('\n── 가운뎃점 정규화 ──');
t("'시설ㆍ공간ㆍ보육'", normalizeText('시설ㆍ공간ㆍ보육'), '시설 공간 보육');
t("NFKC 거친 'ᆞ' 도",  normalizeText('시설ᆞ공간'),  '시설 공간');

console.log('\n── idfWeight 경계 ──');
t('idfWeight(0,1)', idfWeight(0, 1), 1);
t('idfWeight(1,1)', idfWeight(1, 1), 1);
t('idfWeight(0,0)', idfWeight(0, 0), 1);
console.log(`  ℹ️  idfWeight(10,5326) = ${idfWeight(10, 5326).toFixed(4)} (정상 범위)`);

console.log('\n── 조사 절단 보험 ──');
const pg = planQuery('전문가');
const terms = pg.groups[0] ? pg.groups[0].alternatives.flatMap((a) => a.terms) : [];
t("'전문가' 가 검색 대안에 남아 있다", terms.includes('전문가'), true);
const pm = planQuery('미네럴을 이용한 축산');
t("'미네럴을' 은 어간 '미네랄' 로 정규화", pm.groups.map((g) => g.primary), ['미네랄', '축산']);

console.log(`\n${fail === 0 ? '✅ 전부 통과' : `❌ ${fail}건 실패`}`);
process.exitCode = fail ? 1 : 0;
