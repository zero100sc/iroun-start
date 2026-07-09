-- 기업명 + 상담 요청 항목 컬럼 추가
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS company_name  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS consult_type  VARCHAR(100);
