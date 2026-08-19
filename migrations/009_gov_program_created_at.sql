-- ════════════════════════════════════════════════════════
--  009 — gov_program.created_at 복구
--
--  003_programs_seed.sql 은 gov_program 을 CREATE TABLE IF NOT EXISTS 로 만들면서
--  created_at 을 정의해 두었지만, 그 시점에 테이블이 이미 존재했던 탓에 문장 전체가
--  건너뛰어져 실제 DB 에는 컬럼이 생기지 않았다. (2026-08-19 실측 — 스키마에 없음)
--
--  이 컬럼이 필요한 이유:
--  일일 증분 수집이 "이번 실행에서 새로 들어온 공고"를 골라내는 유일한 기준이다.
--  synced_at·last_seen_at 은 갱신 때마다 바뀌어 최초 등록 시점을 알 수 없다.
-- ════════════════════════════════════════════════════════

ALTER TABLE gov_program ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- 기존 행 백필. 자동 수집분은 synced_at 이 최초 등록 시점에 가장 가까운 값이고,
-- 수기 시드분은 그마저 없으므로 현재 시각으로 채운다.
-- 어느 쪽이든 '다음 수집 실행 시각보다 과거' 라는 점이 중요하다 — 그래야 기존 공고가
-- 신규로 잘못 잡히지 않는다.
UPDATE gov_program SET created_at = COALESCE(synced_at, NOW()) WHERE created_at IS NULL;

ALTER TABLE gov_program ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE gov_program ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gov_program_created ON gov_program(created_at DESC);
