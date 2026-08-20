-- ════════════════════════════════════════════════════════
--  013 — search_blob 을 소문자로 저장한다
--
--  012 로 본문을 색인에 넣자 blob 이 평균 230자에서 903자로 늘었고,
--  검색이 0.8초에서 2.9초로 느려졌다.
--
--  느려진 자리는 하나다. 후보를 추리는 관문 조건은 4,844행 전부에서 도는데,
--  그게 ILIKE 였다. ILIKE 는 문자마다 UTF-8 케이스 폴딩을 하므로 LIKE 보다 비싸고,
--  그 비용이 blob 길이에 정비례한다.
--
--  2026-08-20 실측 (개념 5개 OR, 서버측 실행시간):
--      ILIKE  1,034ms  →  LIKE  288ms
--
--  색인으로는 이 구간을 못 구한다. pg_trgm 은 세 글자부터 색인을 쓸 수 있는데
--  '의료'·'제약'·'진단' 같은 두 글자 한국어 검색어가 실제 질의의 다수라,
--  그런 말은 어차피 전체 훑기로 떨어진다. 그래서 훑기 자체를 싸게 만들어야 한다.
--
--  blob 을 소문자로 저장해 두면 검색 쪽은 검색어만 소문자로 낮춰 LIKE 로 비교하면 된다.
--  한글은 대소문자가 없으니 영향이 없고, 영문 약어(AI·R&D)는 양쪽 다 소문자가 되어
--  결과가 지금과 같다. 필드별 가중치 계산은 관문을 통과한 소수의 행에서만 돌므로
--  거기는 ILIKE 를 그대로 둔다 (원본 대소문자를 봐야 하는 곳이다).
--
--  ※ 검색 쪽 짝은 src/search/rank.js 의 blobMatcher 다. 둘은 항상 같이 바뀌어야 한다.
-- ════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_gov_program_blob_trgm;
ALTER TABLE gov_program DROP COLUMN IF EXISTS search_blob;

ALTER TABLE gov_program ADD COLUMN search_blob TEXT
  GENERATED ALWAYS AS (
    lower(
      COALESCE(name, '')                              || ' ' ||
      COALESCE(field, '')                             || ' ' ||
      COALESCE(gov_tags_text(normalized_tags), '')    || ' ' ||
      COALESCE(summary, '')                           || ' ' ||
      COALESCE(agency, '')                            || ' ' ||
      COALESCE(body_text, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_gov_program_blob_trgm
  ON gov_program USING GIN (search_blob gin_trgm_ops);

-- 컬럼을 다시 만들면 통계가 사라진다. 플래너가 rows=1 로 오판해
-- 엉뚱한 실행계획을 고르지 않도록 바로 갱신한다.
ANALYZE gov_program;
