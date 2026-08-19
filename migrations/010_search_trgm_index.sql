-- ════════════════════════════════════════════════════════
--  010 — 검색 속도를 위한 trigram 색인
--
--  왜 필요한가:
--    새 검색은 필드별 가중치를 매기려고 모든 행에 CASE 식을 계산했고, 그 탓에 질의마다
--    5,326행 풀스캔이 일어났다. 2026-08-19 실측으로 1.4초~5.1초가 걸렸다.
--    (개념 5개짜리 질의는 행마다 ILIKE 를 100번 가까이 평가한다)
--
--  해법:
--    ILIKE '%...%' 는 B-tree 로는 못 타지만 pg_trgm 의 GIN 색인으로는 탈 수 있다.
--    검색 실행기는 "핵심어가 하나라도 걸리는 행" 만 먼저 추리고(여기서 색인이 쓰인다),
--    점수 계산은 살아남은 소수의 행에만 한다.
--
--  주의:
--    GIN 색인은 쓰기를 느리게 한다. 일일 수집이 하루 수십~수백 건 UPSERT 하는 정도라
--    문제되지 않지만, 대량 재적재 전에는 색인을 지웠다 다시 만드는 편이 빠를 수 있다.
-- ════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_gov_program_name_trgm
  ON gov_program USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gov_program_summary_trgm
  ON gov_program USING GIN (summary gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gov_program_field_trgm
  ON gov_program USING GIN (field gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_gov_program_agency_trgm
  ON gov_program USING GIN (agency gin_trgm_ops);

-- normalized_tags 는 배열이라 검색식에서 문자열로 펴서 쓴다.
-- 그런데 array_to_string 은 STABLE 이라 식 색인에 바로 쓸 수 없다("must be marked IMMUTABLE").
-- 입력 타입을 text[] 로 고정하면 결과가 항상 같으므로, IMMUTABLE 래퍼를 두는 것이 안전하다.
CREATE OR REPLACE FUNCTION gov_tags_text(text[])
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  RETURNS NULL ON NULL INPUT
AS $$ SELECT array_to_string($1, ' ') $$;

-- 색인과 질의가 **글자 단위로 같은 식** 을 써야 플래너가 색인을 탄다.
-- 검색 실행기(src/search/rank.js)도 반드시 gov_tags_text(normalized_tags) 를 쓸 것.
CREATE INDEX IF NOT EXISTS idx_gov_program_tags_trgm
  ON gov_program USING GIN (gov_tags_text(normalized_tags) gin_trgm_ops);
