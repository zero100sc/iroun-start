/**
 * 일일 증분 수집 — 매일 아침 스케줄러가 부르는 진입점.
 *
 *   npm run collect:daily
 *
 * 전량 수집(run-collector.js)과 다른 점은 '어디서부터 다시 볼지'를 스스로 정한다는 것뿐이다.
 * DB 에 이미 들어와 있는 가장 최신 공고 날짜를 읽어, 거기서 LOOKBACK_DAYS 만큼 되돌린
 * 지점부터 다시 훑는다. 그 이전은 수집기가 순회 자체를 끊으므로(onegov/index.js 의 since 절단)
 * 하루치 실행은 보통 3~5분에 끝난다.
 *
 * 되돌리는 이유:
 *   OneGov 목록은 published_at 내림차순인데, 공고가 게시일보다 늦게 OneGov 에 실리는 경우가 있다.
 *   경계를 '마지막 수집 시점' 으로 딱 맞추면 그렇게 뒤늦게 올라온 건을 영영 놓친다.
 *   겹쳐 읽는 비용은 거의 없다 — content_hash 가 같으면 UPDATE 없이 skipped 로 처리된다.
 */
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { runSource, closeExpired } = require('../src/collectors/runner');

const SOURCE_ID = 'onegov';
const LOOKBACK_DAYS = 7;    // 최신 공고 날짜에서 되돌려 볼 기간
const FALLBACK_DAYS = 30;   // DB 가 비어 있을 때(첫 실행) 볼 기간
const MAX_PAGES = 30;       // 안전장치 — 증분이면 10페이지 안쪽에서 끝난다

const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl) {
  console.error('❌ DATABASE_URL 이 없습니다. 실행 환경의 시크릿 설정을 확인하세요.');
  process.exit(1);
}
const useSSL = !dbUrl.includes('/cloudsql/') && !dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1');

const ymd = (d) => d.toISOString().slice(0, 10);

/** 이미 수집된 것 중 가장 최신 공고의 게시일. 없으면 null. */
async function latestCollectedDate(pool) {
  const { rows } = await pool.query(
    `SELECT MAX((payload->>'published_at')::timestamptz) AS newest
       FROM raw_document WHERE source_id = $1`,
    [SOURCE_ID],
  );
  return rows[0]?.newest ? new Date(rows[0].newest) : null;
}

async function main() {
  const pool = new Pool({ connectionString: dbUrl, ssl: useSSL ? { rejectUnauthorized: false } : false });

  try {
    const before = await pool.query('SELECT COUNT(*)::int AS c FROM gov_program');

    const newest = await latestCollectedDate(pool);
    const anchor = newest || new Date();
    const backDays = newest ? LOOKBACK_DAYS : FALLBACK_DAYS;
    const since = ymd(new Date(anchor.getTime() - backDays * 86_400_000));

    console.log('━━━ 일일 증분 수집 ━━━');
    console.log(`기존 최신 공고: ${newest ? ymd(newest) : '(없음 — 첫 실행)'}`);
    console.log(`조회 시작점   : ${since}  (${backDays}일 되돌림)`);
    console.log(`현재 DB 공고  : ${before.rows[0].c}건\n`);

    const r = await runSource(pool, SOURCE_ID, { live: true, since, maxPages: MAX_PAGES });

    const closed = await closeExpired(pool);
    const after = await pool.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_open)::int AS open FROM gov_program`,
    );
    const added = after.rows[0].total - before.rows[0].c;

    console.log('\n━━━ 결과 ━━━');
    console.log(`상태        : ${r.status}`);
    console.log(`확인한 공고 : ${r.fetched}건`);
    console.log(`신규 등록   : ${added}건`);
    console.log(`내용 갱신   : ${Math.max(0, r.upserted - added)}건`);
    console.log(`변동 없음   : ${r.skipped}건`);
    console.log(`마감 처리   : ${closed}건`);
    console.log(`오류        : ${r.errors}건`);
    console.log(`\nDB 총계     : ${after.rows[0].total}건 (모집중 ${after.rows[0].open}건)`);

    // 오류가 하나라도 있으면 스케줄러가 실패로 인지하도록 종료코드를 남긴다.
    if (r.status === 'failed') process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ 수집 실패:', err.message);
  process.exit(1);
});
