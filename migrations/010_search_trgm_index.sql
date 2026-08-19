-- ════════════════════════════════════════════════════════
--  010 — 검색용 trigram 확장과 태그 헬퍼
--
--  왜 필요한가:
--    검색 점수식은 단어 하나마다 여러 필드를 ILIKE 로 훑는다. 색인이 없으면 질의마다
--    풀스캔이 돌아 2026-08-19 실측으로 1.4초~5.1초가 걸렸다.
--    ILIKE '%...%' 는 B-tree 로는 못 타지만 pg_trgm 의 GIN 색인으로는 탈 수 있다.
--
--  실제 색인은 011 이 만드는 search_blob 한 컬럼에만 건다.
--    처음에는 name·summary·field·agency·tags 에 각각 GIN 색인을 만들었지만,
--    검색기가 통합 컬럼(search_blob)으로 먼저 거르도록 바뀌면서 그 다섯 개는
--    어떤 질의로도 도달하지 않는 죽은 색인이 됐다. 색인은 공짜가 아니다 —
--    쓰이지도 않으면서 매일 수집 UPSERT 를 느리게 하고 디스크를 먹는다.
--    (db-f1-micro 라 더 아깝다. 2026-08-19 리뷰에서 지적)
-- ════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- normalized_tags 는 배열이라 검색식에서 문자열로 펴서 쓴다.
-- 그런데 array_to_string 은 STABLE 이라 식 색인·생성컬럼에 바로 쓸 수 없다
-- ("functions in index expression must be marked IMMUTABLE").
-- 입력 타입을 text[] 로 고정하면 결과가 항상 같으므로 IMMUTABLE 래퍼를 둔다.
CREATE OR REPLACE FUNCTION gov_tags_text(text[])
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  RETURNS NULL ON NULL INPUT
AS $$ SELECT array_to_string($1, ' ') $$;

-- 이 마이그레이션의 앞선 판본에서 만들었던 필드별 GIN 색인을 정리한다.
-- (이미 적용한 환경에서도 깨끗하게 떨어지도록 IF EXISTS 로 지운다)
DROP INDEX IF EXISTS idx_gov_program_name_trgm;
DROP INDEX IF EXISTS idx_gov_program_summary_trgm;
DROP INDEX IF EXISTS idx_gov_program_field_trgm;
DROP INDEX IF EXISTS idx_gov_program_agency_trgm;
DROP INDEX IF EXISTS idx_gov_program_tags_trgm;
