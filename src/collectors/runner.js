/**
 * 수집 러너 — 소스 하나를 처음부터 끝까지 돌린다.
 *
 *   ingestion_source 조회 → 페이지 순회 → raw_document 보관
 *   → normalize → gov_program UPSERT → ingestion_run 마감
 *
 * 설계상 중요한 점:
 *  · API 키가 없으면 자동으로 mock 모드로 내려간다(빈손으로 실패하지 않음)
 *  · content_hash 로 무변경 건을 걸러 불필요한 UPDATE 와 synced_at 갱신을 막는다
 *  · 한 건이 깨져도 전체를 중단하지 않고 error_count 로 집계한다
 */
const crypto = require('crypto');
const path = require('path');
const { HttpClient } = require('./base/http-client');

const MAX_PAGES = 50; // 안전장치 — 잘못된 hasMore 로 무한 루프에 빠지지 않도록

/**
 * 정규화 규칙 버전.
 *
 * content_hash 는 무변경 건을 걸러 불필요한 UPDATE 를 막는 장치인데, 원문만으로 해시를
 * 만들면 '원문은 그대로인데 정규화 규칙만 고친' 경우가 영원히 반영되지 않는다.
 * 그래서 이 값을 해시에 섞는다. **분류·추출 로직을 고치면 반드시 올릴 것.**
 */
const NORMALIZER_VERSION = 3;

function sha256(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/** ingestion_source.id 와 같은 이름의 폴더에서 수집기 모듈을 읽는다. */
function loadCollector(sourceId) {
  if (!/^[a-z0-9-]+$/.test(sourceId)) throw new Error(`허용되지 않는 소스 id: ${sourceId}`);
  return require(path.join(__dirname, sourceId, 'index.js'));
}

async function runSource(pool, sourceId, { live = false, maxPages = MAX_PAGES, since = null } = {}) {
  const { rows: srcRows } = await pool.query(
    'SELECT * FROM ingestion_source WHERE id = $1 AND enabled = TRUE',
    [sourceId],
  );
  if (!srcRows.length) throw new Error(`소스를 찾을 수 없거나 비활성 상태입니다: ${sourceId}`);
  const source = srcRows[0];

  // 인증이 필요한 소스(auth_env_var 있음)와 공개 API(없음)를 구분한다.
  // OneGov 처럼 키가 없는 게 정상인 소스를 '키 없음 = mock' 으로 취급하면 안 된다.
  const needsKey = Boolean(source.auth_env_var);
  const apiKey = needsKey ? (process.env[source.auth_env_var] || '') : '';
  const mockMode = !live || (needsKey && !apiKey);

  if (live && needsKey && !apiKey) {
    console.warn(`⚠ ${sourceId}: ${source.auth_env_var} 가 비어 있어 mock 모드로 실행합니다.`);
  }

  const { rows: runRows } = await pool.query(
    `INSERT INTO ingestion_run (source_id, mock_mode) VALUES ($1, $2) RETURNING id`,
    [sourceId, mockMode],
  );
  const runId = runRows[0].id;

  const collector = loadCollector(sourceId);
  // useMock 을 config 로도 넘긴다 — 키를 쓰지 않는 수집기는 apiKey 로 모드를 알 수 없다.
  // since 가 있으면 수집기가 그 날짜 이전 문서를 버리고 페이지 순회도 거기서 끊는다.
  const config = {
    ...(source.config || {}),
    baseUrl: source.base_url,
    useMock: mockMode,
    ...(since ? { since } : {}),
  };
  const client = new HttpClient({ ratePerMin: source.rate_limit_per_min });
  const pageSize = config.pageSize || 100;

  const stat = { fetched: 0, upserted: 0, skipped: 0, errors: 0 };
  let firstError = null;

  try {
    for (let page = 1; page <= maxPages; page++) {
      const { rows, hasMore } = await collector.fetchPage({
        client,
        config,
        apiKey: mockMode ? '' : apiKey,
        page,
        pageSize,
      });
      // 이 페이지가 전부 필터에 걸려 0건이어도, 수집기가 hasMore 라고 하면 계속 간다.
      // (OneGov 는 한 페이지가 통째로 입찰공고인 경우가 흔하다 — 여기서 멈추면 뒤를 통째로 놓친다)
      if (!rows.length && !hasMore) break;
      stat.fetched += rows.length;

      for (const raw of rows) {
        try {
          const hash = sha256({ raw, v: NORMALIZER_VERSION });
          const program = collector.normalize(raw);

          // 원문은 정규화 성공 여부와 무관하게 먼저 보관한다.
          // 정규화에 실패한 문서야말로 나중에 규칙을 고쳐 재처리해야 할 대상인데,
          // 예전에는 normalize 실패 시 continue 로 빠져나가 그 원문이 남지 않았다.
          // (007_ingestion.sql 이 내건 '원문과 정규화 결과를 분리 보관' 원칙과 정면으로 어긋났다)
          // source_doc_id 는 정규화 결과에서 오므로, 실패 시 수집기 원본 id 로 대체한다.
          const rawDocId = program ? program.source_doc_id : (raw && raw.id ? String(raw.id) : null);
          if (rawDocId) {
            await pool.query(
              `INSERT INTO raw_document (source_id, run_id, source_doc_id, payload, content_hash)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (source_id, source_doc_id, content_hash) DO NOTHING`,
              [sourceId, runId, rawDocId, JSON.stringify(raw), hash],
            );
          }

          if (!program) { stat.skipped++; continue; }

          const changed = await upsertProgram(pool, program, hash, source.kogl_type);
          if (changed) stat.upserted++; else stat.skipped++;
        } catch (err) {
          stat.errors++;
          if (!firstError) firstError = err.message;
          console.error(`  · 1건 실패: ${err.message}`);
        }
      }

      if (!hasMore) break;
    }

    const status = stat.errors === 0 ? 'success' : (stat.upserted > 0 ? 'partial' : 'failed');
    await finishRun(pool, runId, status, stat, firstError);
    return { runId, mockMode, status, ...stat };
  } catch (err) {
    await finishRun(pool, runId, 'failed', stat, err.message);
    throw err;
  }
}

/**
 * gov_program UPSERT.
 * @returns {boolean} 실제로 새로 넣었거나 내용이 바뀌어 갱신했으면 true
 */
async function upsertProgram(pool, p, hash, koglType) {
  const { rows } = await pool.query(
    `INSERT INTO gov_program (
       program_id, source_portal, source_doc_id, name, agency, field,
       target_stages, target_segments, target_industries, region,
       amount_text, max_amount, funding_type, period_start, period_end,
       detail_url, summary, normalized_tags,
       content_hash, kogl_type, is_open, last_seen_at, auto_ingested, synced_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       COALESCE($15::date >= CURRENT_DATE, TRUE), NOW(), TRUE, NOW()
     )
     ON CONFLICT (source_portal, source_doc_id) WHERE source_doc_id IS NOT NULL
     DO UPDATE SET
       name = EXCLUDED.name,
       agency = EXCLUDED.agency,
       field = EXCLUDED.field,
       target_stages = EXCLUDED.target_stages,
       target_segments = EXCLUDED.target_segments,
       -- target_industries 와 kogl_type 은 INSERT 에만 있고 UPDATE 에서 빠져 있었다.
       -- target_industries 는 matchProgram 의 하드필터라(server.js), 낡은 값이 굳으면
       -- 공고가 특정 프로필에게 영구히 안 보이게 된다. (2026-08-19 리뷰에서 발견)
       target_industries = EXCLUDED.target_industries,
       kogl_type = EXCLUDED.kogl_type,
       region = EXCLUDED.region,
       amount_text = EXCLUDED.amount_text,
       max_amount = EXCLUDED.max_amount,
       funding_type = EXCLUDED.funding_type,
       period_start = EXCLUDED.period_start,
       period_end = EXCLUDED.period_end,
       detail_url = EXCLUDED.detail_url,
       summary = EXCLUDED.summary,
       normalized_tags = EXCLUDED.normalized_tags,
       content_hash = EXCLUDED.content_hash,
       is_open = EXCLUDED.is_open,
       last_seen_at = NOW(),
       synced_at = NOW()
     WHERE gov_program.content_hash IS DISTINCT FROM EXCLUDED.content_hash
     RETURNING program_id`,
    [
      p.program_id, p.source_portal, p.source_doc_id, p.name, p.agency, p.field,
      p.target_stages, p.target_segments, p.target_industries, p.region,
      p.amount_text, p.max_amount, p.funding_type, p.period_start, p.period_end,
      p.detail_url, p.summary, p.normalized_tags, hash, koglType,
    ],
  );

  // 내용이 같으면 DO UPDATE 의 WHERE 가 막아 0행 → 마지막 확인 시각만 갱신한다.
  if (rows.length === 0) {
    await pool.query(
      `UPDATE gov_program SET last_seen_at = NOW()
        WHERE source_portal = $1 AND source_doc_id = $2`,
      [p.source_portal, p.source_doc_id],
    );
    return false;
  }
  return true;
}

function finishRun(pool, runId, status, stat, errorText) {
  return pool.query(
    `UPDATE ingestion_run
        SET finished_at = NOW(), status = $2,
            fetched_count = $3, upsert_count = $4, skipped_count = $5,
            error_count = $6, error_text = $7
      WHERE id = $1`,
    [runId, status, stat.fetched, stat.upserted, stat.skipped, stat.errors, errorText || null],
  );
}

/** 마감일이 지난 공고를 닫는다(매 수집 후 호출). */
async function closeExpired(pool) {
  const { rowCount } = await pool.query(
    `UPDATE gov_program SET is_open = FALSE
      WHERE auto_ingested = TRUE AND is_open = TRUE
        AND period_end IS NOT NULL AND period_end < CURRENT_DATE`,
  );
  return rowCount;
}

module.exports = { runSource, closeExpired };
