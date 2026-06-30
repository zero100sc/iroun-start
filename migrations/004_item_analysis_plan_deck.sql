-- ════════════════════════════════════════════════════════
--  004 — STEP2·3·5·6·7 도메인 (AI 생성물은 목업, 구조는 실제)
--  PRD 4.2 기준
-- ════════════════════════════════════════════════════════

-- ── STEP2: 아이템 정의 ──
CREATE TABLE IF NOT EXISTS item_overview (
  profile_id       INT PRIMARY KEY REFERENCES customer_profile(id) ON DELETE CASCADE,
  usage_spec_price TEXT, core_function TEXT, customer_benefit TEXT
);
CREATE TABLE IF NOT EXISTS item_problem (
  profile_id    INT PRIMARY KEY REFERENCES customer_profile(id) ON DELETE CASCADE,
  market_status TEXT, problem_point TEXT, necessity TEXT
);
CREATE TABLE IF NOT EXISTS item_feasibility (
  profile_id  INT PRIMARY KEY REFERENCES customer_profile(id) ON DELETE CASCADE,
  dev_plan    TEXT, output_form TEXT, output_qty TEXT, milestones JSONB
);
CREATE TABLE IF NOT EXISTS item_differentiation (
  profile_id INT PRIMARY KEY REFERENCES customer_profile(id) ON DELETE CASCADE,
  strategy_1 TEXT, strategy_2 TEXT, strategy_3 TEXT     -- 정확히 3개
);
CREATE TABLE IF NOT EXISTS item_name_suggestion (
  id              SERIAL PRIMARY KEY,
  profile_id      INT NOT NULL REFERENCES customer_profile(id) ON DELETE CASCADE,
  suggestion_text TEXT,
  type            VARCHAR(20),                          -- 기술중심/혜택중심/문제중심
  selected        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_itemname_profile ON item_name_suggestion(profile_id);

-- ── STEP3: 전문 액셀러레이터 분석 ──
CREATE TABLE IF NOT EXISTS accelerator_analysis (
  id                    SERIAL PRIMARY KEY,
  profile_id            INT NOT NULL REFERENCES customer_profile(id) ON DELETE CASCADE,
  problem_fit_score     INT,  -- 1~5
  market_score          INT,
  founder_fit_score     INT,
  differentiation_score INT,
  scalability_score     INT,
  version               INT NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS accelerator_comment (
  id           SERIAL PRIMARY KEY,
  analysis_id  INT NOT NULL REFERENCES accelerator_analysis(id) ON DELETE CASCADE,
  area         VARCHAR(50),
  comment_text TEXT,
  type         VARCHAR(20)                              -- 강점 / 보완
);

-- ── STEP5: 지원 건(Application) + 사업계획서 ──
CREATE TABLE IF NOT EXISTS application (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id VARCHAR(50) REFERENCES gov_program(program_id) ON DELETE SET NULL,
  status     VARCHAR(30) NOT NULL DEFAULT 'DRAFTING_PLAN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, program_id)
);
CREATE TABLE IF NOT EXISTS business_plan (
  id             SERIAL PRIMARY KEY,
  application_id INT NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  status         VARCHAR(20) NOT NULL DEFAULT '초안',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS business_plan_section (
  id            SERIAL PRIMARY KEY,
  plan_id       INT NOT NULL REFERENCES business_plan(id) ON DELETE CASCADE,
  section_key   VARCHAR(50),
  section_title VARCHAR(100),
  content       TEXT,
  char_limit    INT,
  ai_generated  BOOLEAN NOT NULL DEFAULT TRUE,
  version       INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_plansection_plan ON business_plan_section(plan_id);

-- ── STEP6: 발표 슬라이드 ──
CREATE TABLE IF NOT EXISTS pitch_deck (
  id         SERIAL PRIMARY KEY,
  plan_id    INT NOT NULL REFERENCES business_plan(id) ON DELETE CASCADE,
  theme      VARCHAR(30) NOT NULL DEFAULT '기본형',
  status     VARCHAR(20) NOT NULL DEFAULT '초안',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS pitch_deck_slide (
  id                SERIAL PRIMARY KEY,
  deck_id           INT NOT NULL REFERENCES pitch_deck(id) ON DELETE CASCADE,
  order_no          INT,
  slide_type        VARCHAR(50),
  headline          TEXT,
  body_content      TEXT,
  visual_suggestion TEXT
);
CREATE INDEX IF NOT EXISTS idx_slide_deck ON pitch_deck_slide(deck_id);

-- ── STEP7: 전문가 컨설팅 신청 (회원 연계) ──
CREATE TABLE IF NOT EXISTS consulting_request (
  id             SERIAL PRIMARY KEY,
  user_id        INT REFERENCES users(id) ON DELETE SET NULL,
  application_id INT REFERENCES application(id) ON DELETE SET NULL,
  area           VARCHAR(50),                           -- 사업계획서첨삭/발표코칭/서류준비/세무노무
  message        TEXT,
  context        JSONB,                                 -- 프로필+매칭 스냅샷
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consulting_user ON consulting_request(user_id);
