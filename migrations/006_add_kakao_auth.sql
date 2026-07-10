-- ════════════════════════════════════════════════════════
--  006 — 카카오 OAuth 2.0 지원
-- ════════════════════════════════════════════════════════

-- 카카오 ID + 인증 수단 컬럼 추가
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS kakao_id     VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'email';

-- 카카오 가입자는 이메일·비밀번호 없이 가입 가능
ALTER TABLE users ALTER COLUMN email         DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_kakao_id ON users(kakao_id);
