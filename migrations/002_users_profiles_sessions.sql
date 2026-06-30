-- ════════════════════════════════════════════════════════
--  002 — 회원 인증 · 고객 프로필 · 세션 스토어
--  PRD 4장(데이터 아키텍처) L1 고객 데이터 레이어 기준
-- ════════════════════════════════════════════════════════

-- ── 세션 스토어 (connect-pg-simple 표준 스키마) ──
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    varchar      NOT NULL COLLATE "default",
  "sess"   json         NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- ── 회원 ──
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100),
  phone         VARCHAR(20),
  role          VARCHAR(20)  NOT NULL DEFAULT 'member',   -- member | admin
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ── 세그먼트 마스터 (9종, 하드코딩 금지 — 코드성 관리) ──
CREATE TABLE IF NOT EXISTS segment_master (
  code       VARCHAR(20) PRIMARY KEY,
  label      VARCHAR(50) NOT NULL,
  definition TEXT,
  sort_order INT     NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO segment_master (code, label, definition, sort_order) VALUES
  ('PRE',    '예비창업자',         '사업자등록 전, 아이디어 단계',                 1),
  ('EARLY',  '기창업자(3년 이내)', '창업 후 3년 미만 법인/개인사업자',             2),
  ('SMB',    '소상공인',           '상시근로자 5인(제조업 등 10인) 미만',          3),
  ('YOUTH',  '청년창업자',         '만 39세 이하',                                  4),
  ('SENIOR', '중장년창업자',       '만 40세 이상(퇴직 예정/퇴직자)',               5),
  ('WORKER', '직장인창업자',       '재직 중 부업/예비 창업 준비',                  6),
  ('WOMAN',  '여성창업자',         '여성 대표 또는 공동대표',                       7),
  ('LOAN',   '정책자금(대출) 문의자', '융자·보증 중심 자금 수요',                  8),
  ('RND',    'R&D 지원사업 참여자', '기술개발 과제 수행/예정 기업',                 9)
ON CONFLICT (code) DO NOTHING;

-- ── 고객 마스터 프로필 (STEP1) ──
CREATE TABLE IF NOT EXISTS customer_profile (
  id             SERIAL PRIMARY KEY,
  user_id        INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  biz_name       VARCHAR(150),
  founded_year   VARCHAR(20),                 -- 연도 또는 '설립 전'
  industry_code  VARCHAR(50),                 -- 표준산업분류(매칭 API와 코드 통일)
  region_sido    VARCHAR(50),
  region_sigungu VARCHAR(50),
  employee_cnt   INT,
  revenue_band   VARCHAR(50),
  segments       TEXT[] NOT NULL DEFAULT '{}',-- 9종 코드 다중
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profile_user     ON customer_profile(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_industry ON customer_profile(industry_code);
CREATE INDEX IF NOT EXISTS idx_profile_segments ON customer_profile USING GIN (segments);

-- ── 사업 정보 (1:1) ──
CREATE TABLE IF NOT EXISTS profile_business (
  profile_id        INT PRIMARY KEY REFERENCES customer_profile(id) ON DELETE CASCADE,
  biz_summary       TEXT,
  biz_summary_cache TEXT,                      -- STEP2~6 재사용 요약 캐시
  product_desc      TEXT,
  core_tech         TEXT,
  competitive_edge  TEXT
);

-- ── 특허·인증 (1:N) ──
CREATE TABLE IF NOT EXISTS profile_patent (
  id          SERIAL PRIMARY KEY,
  profile_id  INT NOT NULL REFERENCES customer_profile(id) ON DELETE CASCADE,
  type        VARCHAR(20),                     -- 특허 | 인증
  name        VARCHAR(200),
  number      VARCHAR(100),
  issued_date DATE
);
CREATE INDEX IF NOT EXISTS idx_patent_profile ON profile_patent(profile_id);

-- ── 과거 정부지원사업 수행 이력 (1:N) ──
CREATE TABLE IF NOT EXISTS profile_funding_history (
  id           SERIAL PRIMARY KEY,
  profile_id   INT NOT NULL REFERENCES customer_profile(id) ON DELETE CASCADE,
  program_name VARCHAR(200),
  year         VARCHAR(10),
  amount       BIGINT,
  status       VARCHAR(50)
);
CREATE INDEX IF NOT EXISTS idx_fhist_profile ON profile_funding_history(profile_id);

-- ── 현재 보유 정책자금/대출 (1:N) ──
CREATE TABLE IF NOT EXISTS profile_funding_current (
  id          SERIAL PRIMARY KEY,
  profile_id  INT NOT NULL REFERENCES customer_profile(id) ON DELETE CASCADE,
  institution VARCHAR(150),
  amount      BIGINT,
  loan_type   VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS idx_fcur_profile ON profile_funding_current(profile_id);
