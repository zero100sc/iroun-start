-- ════════════════════════════════════════════════════════
--  007 — 공고 자동 수집(ingestion) 계층
--
--  003 의 주석 "※ 시드 12건은 랜딩 공고 기반. 추후 크롤링 시스템 연동으로 교체 가능"
--  을 실제로 구현한다. gov_program 은 그대로 두고(기존 매칭 로직 무손상),
--  수집기가 같은 테이블을 채우도록 컬럼과 부속 테이블만 추가한다.
--
--  설계 원칙 (Public Compass 수집기 구조에서 차용):
--   · 원문(raw)과 정규화 결과(gov_program)를 분리 보관 → 정규화 규칙이 바뀌어도 재처리 가능
--   · 실행 이력(ingestion_run)을 남겨 "언제 무엇이 몇 건 들어왔는지" 추적
--   · 소스별 설정을 DB에 두어 코드 배포 없이 on/off·유량 조절 가능
-- ════════════════════════════════════════════════════════

-- ── 수집 소스 레지스트리 ──
-- id 는 반드시 src/collectors/<id>/ 폴더명과 일치해야 한다(러너가 이 값으로 모듈을 찾음).
CREATE TABLE IF NOT EXISTS ingestion_source (
  id                 VARCHAR(30) PRIMARY KEY,
  name               VARCHAR(120) NOT NULL,
  base_url           TEXT,
  auth_env_var       VARCHAR(60),            -- 이 환경변수가 비어 있으면 러너가 자동으로 mock 모드
  rate_limit_per_min INT     NOT NULL DEFAULT 30,
  mock_mode          BOOLEAN NOT NULL DEFAULT TRUE,
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  kogl_type          SMALLINT NOT NULL DEFAULT 1 CHECK (kogl_type BETWEEN 1 AND 4),
  config             JSONB   NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 실행 이력 ──
CREATE TABLE IF NOT EXISTS ingestion_run (
  id            SERIAL PRIMARY KEY,
  source_id     VARCHAR(30) NOT NULL REFERENCES ingestion_source(id) ON DELETE CASCADE,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  status        VARCHAR(20) NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','success','partial','failed')),
  mock_mode     BOOLEAN NOT NULL DEFAULT FALSE,
  fetched_count INT NOT NULL DEFAULT 0,   -- 원문으로 받아온 건수
  upsert_count  INT NOT NULL DEFAULT 0,   -- gov_program 에 신규/갱신된 건수
  skipped_count INT NOT NULL DEFAULT 0,   -- 내용 무변경으로 건너뛴 건수
  error_count   INT NOT NULL DEFAULT 0,
  error_text    TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_source ON ingestion_run(source_id, started_at DESC);

-- ── 원문 보관 ──
-- 정규화 규칙을 고치더라도 외부 API 를 다시 때리지 않고 재처리할 수 있게 원문을 남긴다.
CREATE TABLE IF NOT EXISTS raw_document (
  id            SERIAL PRIMARY KEY,
  source_id     VARCHAR(30)  NOT NULL REFERENCES ingestion_source(id) ON DELETE CASCADE,
  run_id        INT          REFERENCES ingestion_run(id) ON DELETE SET NULL,
  source_doc_id VARCHAR(120) NOT NULL,   -- 외부 시스템의 공고 ID
  payload       JSONB        NOT NULL,
  content_hash  TEXT         NOT NULL,   -- payload 의 sha256 — 무변경 감지용
  fetched_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, source_doc_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_raw_source_doc ON raw_document(source_id, source_doc_id);

-- ── gov_program 확장 ──
-- 기존 12건 시드는 source_doc_id 가 NULL 로 남아 수집분과 자연히 구분된다.
ALTER TABLE gov_program ADD COLUMN IF NOT EXISTS source_doc_id VARCHAR(120);
ALTER TABLE gov_program ADD COLUMN IF NOT EXISTS content_hash  TEXT;
ALTER TABLE gov_program ADD COLUMN IF NOT EXISTS kogl_type     SMALLINT;
ALTER TABLE gov_program ADD COLUMN IF NOT EXISTS period_start  DATE;
ALTER TABLE gov_program ADD COLUMN IF NOT EXISTS is_open       BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE gov_program ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ;
ALTER TABLE gov_program ADD COLUMN IF NOT EXISTS auto_ingested BOOLEAN NOT NULL DEFAULT FALSE;

-- 같은 공고가 재수집돼도 한 행으로 모이게 하는 자연키.
-- 부분 인덱스라 기존 시드(source_doc_id IS NULL)는 영향을 받지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_source_doc
  ON gov_program (source_portal, source_doc_id)
  WHERE source_doc_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_program_open ON gov_program (is_open, period_end);

-- ── 소스 시드 ──
-- mock_mode = TRUE 로 시작한다. 실제 API 키를 .env 에 넣고
-- `npm run collect -- --live` 로 돌리면 러너가 자동으로 실데이터 모드로 전환한다.
INSERT INTO ingestion_source (id, name, base_url, auth_env_var, rate_limit_per_min, mock_mode, enabled, kogl_type, config)
VALUES
  ('kstartup',
   'K-Startup 창업지원사업 공고 (창업진흥원)',
   'https://apis.data.go.kr/B552735/kisedKstartupService01',
   'DATA_GO_KR_API_KEY',
   30, TRUE, TRUE, 1,
   '{"operation":"getAnnouncementInformation01","pageSize":100,"defaultAgency":"창업진흥원","sourcePortal":"KSTARTUP"}'::jsonb),

  ('bizinfo',
   '기업마당 지원사업 공고 (중소벤처기업부)',
   'https://apis.data.go.kr/1421000/mssBizService',
   'DATA_GO_KR_API_KEY',
   30, TRUE, TRUE, 1,
   '{"operation":"getbizList","pageSize":100,"defaultAgency":"중소벤처기업부","sourcePortal":"BIZINFO"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
