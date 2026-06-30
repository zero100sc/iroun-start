/**
 * 간단한 순번 마이그레이션 러너.
 * migrations/*.sql 을 파일명 순으로 적용하고, schema_migrations 에 이력을 남긴다.
 * 사용: npm run migrate
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const dbUrl  = process.env.DATABASE_URL || '';
const useSSL = !dbUrl.includes('/cloudsql/') && !dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1');
const pool   = new Pool({ connectionString: dbUrl, ssl: useSSL ? { rejectUnauthorized: false } : false });

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function migrate() {
  if (!dbUrl) {
    console.error('❌ DATABASE_URL 이 설정되지 않았습니다. .env 를 확인하세요.');
    process.exit(1);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`▶ ${file} ... `);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
      await client.query('COMMIT');
      console.log('완료');
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.log('실패');
      console.error(`   ${err.message}`);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  console.log(count ? `✅ ${count}개 마이그레이션 적용 완료` : '✅ 이미 최신 상태 (적용할 마이그레이션 없음)');
  await pool.end();
}

migrate().catch((err) => { console.error(err); process.exit(1); });
