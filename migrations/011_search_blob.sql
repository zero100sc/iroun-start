-- ════════════════════════════════════════════════════════
--  011 — 검색용 통합 텍스트 컬럼
--
--  문제:
--    점수식은 단어 하나마다 필드 5개(name·field·tags·summary·agency)를 각각 ILIKE 한다.
--    동의어까지 펴면 21개 단어 × 5필드 = 행마다 105회. 5,326행이면 56만 회다.
--    2026-08-19 실측으로 '청년 여성 재창업 컨설팅 교육' 질의가 4.0초 걸렸다.
--
--  해법:
--    다섯 필드를 이어 붙인 컬럼을 하나 두고, 점수식을 이렇게 감싼다.
--
--      CASE WHEN search_blob ILIKE '%단어%' THEN <필드별 가중 계산> ELSE 0 END
--
--    PostgreSQL 의 CASE 는 조건이 거짓이면 THEN 절을 평가하지 않는다.
--    대부분의 단어는 대부분의 행에 없으므로, 실제 비용이 5회에서 1회로 떨어진다.
--    필드별 가중치는 걸린 소수의 행에서만 계산되니 랭킹 결과는 완전히 동일하다.
--
--  GENERATED ALWAYS ... STORED 라 수집기가 따로 채울 필요가 없다.
--  (gov_tags_text 는 010 에서 IMMUTABLE 로 선언해 뒀다 — 생성 컬럼은 IMMUTABLE 만 받는다)
-- ════════════════════════════════════════════════════════

ALTER TABLE gov_program ADD COLUMN IF NOT EXISTS search_blob TEXT
  GENERATED ALWAYS AS (
    COALESCE(name, '')                              || ' ' ||
    COALESCE(field, '')                             || ' ' ||
    COALESCE(gov_tags_text(normalized_tags), '')    || ' ' ||
    COALESCE(summary, '')                           || ' ' ||
    COALESCE(agency, '')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_gov_program_blob_trgm
  ON gov_program USING GIN (search_blob gin_trgm_ops);
