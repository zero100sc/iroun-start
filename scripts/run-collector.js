/**
 * 공고 수집 실행기.
 *
 *   npm run collect                       모든 활성 소스를 mock 데이터로 수집(키 불필요)
 *   npm run collect -- kstartup           특정 소스만
 *   npm run collect -- onegov --live      실제 수집(OneGov 는 API 키 불필요)
 *   npm run collect -- --live --pages=3   가져올 페이지 수 제한(시험 적재용)
 *   npm run collect -- --since=2026-01-01 그 날짜 이후 공고만(그 이전이 나오면 순회 종료)
 *   npm run collect -- --dry              DB 를 건드리지 않고 정규화 결과만 출력
 *
 *   예) 2026년 공고 전량:
 *       npm run collect -- onegov --live --since=2026-01-01 --pages=250
 */
require('dotenv').config();
const { Pool } = require('pg');
const { runSource, closeExpired } = require('../src/collectors/runner');

const args = process.argv.slice(2);
const live = args.includes('--live');
const dry = args.includes('--dry');
const only = args.filter((a) => !a.startsWith('--'));

// --pages=3 → 3페이지만. 생략 시 러너 기본값(50페이지 상한).
const pagesArg = args.find((a) => a.startsWith('--pages='));
const maxPages = pagesArg ? Math.max(1, parseInt(pagesArg.split('=')[1], 10) || 1) : undefined;

// --since=2026-01-01 → 그 날짜 이후 공고만 적재하고, 더 오래된 문서가 나오면 순회를 끊는다.
const sinceArg = args.find((a) => a.startsWith('--since='));
const since = sinceArg ? sinceArg.split('=')[1] : undefined;
if (sinceArg && Number.isNaN(new Date(since).getTime())) {
  console.error(`❌ --since 날짜를 해석할 수 없습니다: ${since} (예: --since=2026-01-01)`);
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || '';
const useSSL = !dbUrl.includes('/cloudsql/') && !dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1');

async function main() {
  if (dry) return dryRun();

  if (!dbUrl) {
    console.error('❌ DATABASE_URL 이 설정되지 않았습니다. .env 를 확인하세요.');
    console.error('   DB 없이 정규화만 확인하려면: npm run collect -- --dry');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl, ssl: useSSL ? { rejectUnauthorized: false } : false });

  // 유휴 커넥션이 끊길 때 pg 는 pool 에 'error' 를 쏜다. 리스너가 없으면 Node 가
  // 그대로 프로세스를 죽인다. 한 시간 넘게 도는 작업이라 중간에 커넥션이 한 번
  // 끊기는 일(프록시 재시작·네트워크 순단)만으로 수집 전체를 잃을 수는 없다.
  // 개별 질의 실패는 아래 루프의 try/catch 가 error_count 로 집계한다.
  pool.on('error', (err) => console.error(`  · 커넥션 오류(무시하고 계속): ${err.message}`));

  try {
    const { rows } = await pool.query(
      'SELECT id, name FROM ingestion_source WHERE enabled = TRUE ORDER BY id',
    );
    const targets = only.length ? rows.filter((r) => only.includes(r.id)) : rows;

    if (!targets.length) {
      console.error(`❌ 실행할 소스가 없습니다. (요청: ${only.join(', ') || '전체'})`);
      console.error('   007_ingestion.sql 마이그레이션을 적용했는지 확인하세요: npm run migrate');
      process.exit(1);
    }

    const scope = (maxPages ? `, 최대 ${maxPages}페이지` : '') + (since ? `, ${since} 이후` : '');
    console.log(`▶ 수집 시작 — ${live ? '실데이터(live)' : 'mock'} 모드, 대상 ${targets.length}개${scope}\n`);

    for (const t of targets) {
      process.stdout.write(`  ${t.id} (${t.name}) ... `);
      try {
        const r = await runSource(pool, t.id, {
          live,
          ...(maxPages ? { maxPages } : {}),
          ...(since ? { since } : {}),
        });
        console.log(
          `${r.status} — 수집 ${r.fetched} / 반영 ${r.upserted} / 무변경 ${r.skipped} / 오류 ${r.errors}`,
        );
      } catch (err) {
        console.log('실패');
        console.error(`    ${err.message}`);
      }
    }

    const closed = await closeExpired(pool);
    if (closed) console.log(`\n· 마감일 경과로 닫은 공고: ${closed}건`);

    const { rows: summary } = await pool.query(
      `SELECT source_portal, COUNT(*) AS total, COUNT(*) FILTER (WHERE is_open) AS open
         FROM gov_program WHERE auto_ingested = TRUE GROUP BY source_portal ORDER BY source_portal`,
    );
    if (summary.length) {
      console.log('\n· 수집 누적 현황');
      for (const s of summary) console.log(`    ${s.source_portal}: 총 ${s.total}건 (모집중 ${s.open}건)`);
    }
    console.log('\n✅ 수집 완료');
  } finally {
    await pool.end();
  }
}

/** DB 없이 정규화 결과만 눈으로 확인하는 모드. */
async function dryRun() {
  console.log('▶ dry 모드 — DB 를 사용하지 않고 mock 데이터의 정규화 결과만 출력합니다.\n');

  for (const id of only.length ? only : ['kstartup', 'bizinfo', 'onegov']) {
    const collector = require(`../src/collectors/${id}/index.js`);
    const { rows } = await collector.fetchPage({
      client: null, config: { useMock: true }, apiKey: '', page: 1, pageSize: 100,
    });

    console.log(`── ${id} (${rows.length}건) ──`);
    for (const raw of rows) {
      const p = collector.normalize(raw);
      if (!p) { console.log('  (정규화 불가 — 건너뜀)'); continue; }
      console.log(`  [${p.program_id}] ${p.name}`);
      console.log(`      업력: ${fmt(p.target_stages)} | 세그먼트: ${fmt(p.target_segments)}`);
      console.log(`      지역: ${p.region} | 유형: ${p.funding_type} | 최대: ${fmtWon(p.max_amount)}`);
      console.log(`      접수: ${p.period_start || '?'} ~ ${p.period_end || '상시'} | 태그: ${fmt(p.normalized_tags)}`);
    }
    console.log('');
  }
}

const fmt = (a) => (a && a.length ? a.join(', ') : '(없음)');
const fmtWon = (n) =>
  n == null ? '(미상)' : n >= 1e8 ? `${(n / 1e8).toFixed(n % 1e8 ? 1 : 0)}억원` : `${(n / 1e4).toLocaleString()}만원`;

main().catch((err) => { console.error(err); process.exit(1); });
