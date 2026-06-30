-- 상담 신청 테이블
CREATE TABLE IF NOT EXISTS submissions (
  id               SERIAL PRIMARY KEY,
  type             VARCHAR(20)  NOT NULL,          -- '예비창업자' | '소상공인'
  name             VARCHAR(100) NOT NULL,
  phone            VARCHAR(20)  NOT NULL,
  -- 예비창업자 전용
  current_status   VARCHAR(50),                    -- 직장인, 학생 등
  business_type    VARCHAR(100),                   -- 창업 예정 업종
  -- 소상공인 전용
  business_name    VARCHAR(100),
  industry         VARCHAR(100),
  operation_period VARCHAR(50),
  employee_count   VARCHAR(20),
  -- 공통
  interests        TEXT[]       DEFAULT '{}',      -- 관심 지원사업 (배열)
  message          TEXT,
  status           VARCHAR(20)  DEFAULT 'pending', -- pending | contacted | completed
  memo             TEXT,                           -- 어드민 메모
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- 어드민 계정 (선택: DB 기반 관리자)
CREATE TABLE IF NOT EXISTS admins (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(50) UNIQUE NOT NULL,
  password   VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_submissions_type   ON submissions(type);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at DESC);
