-- ════════════════════════════════════════════════════════
--  012 — 공고 본문을 검색 색인에 넣는다
--
--  문제:
--    수집기는 /api/content/{id} 로 공고 본문(_body)을 받아 raw_document 에 저장하지만,
--    normalize 는 그 본문을 마감일·금액·지원분야 추출에만 쓰고 버렸다.
--    gov_program 에는 요약 500자만 남아, 검색은 본문을 전혀 못 본다.
--
--  2026-08-20 실측 (4,832건):
--      raw_document._body   평균  674자
--      gov_program.search_blob 평균  230자
--      → 공고 1건당 444자, 전체 텍스트의 약 3분의 2 가 검색 대상 밖이었다.
--
--    그 결과 본문에만 등장하는 말은 아예 검색되지 않았다.
--      반도체    본문 139건 / 검색 50건   (89건 누락)
--      드론      본문  18건 / 검색  3건   (15건 누락)
--      블록체인   본문  46건 / 검색 17건   (29건 누락)
--      바이오    본문 327건 / 검색 195건  (132건 누락)
--
--  해법:
--    본문을 body_text 로 보관하고 search_blob 에 합친다.
--    가중치는 기획서의 필드 서열을 따른다 —
--    공고명·지원분야 > 태그 > 요약 > 본문 > 기관명.
--    본문은 '제외 업종' 같은 부정 문맥도 담고 있어 낮은 가중치가 맞다.
--    (가중치 자체는 src/search/rank.js 의 FIELD_WEIGHTS 에 있다)
--
--  search_blob 은 GENERATED 컬럼이라 정의를 바꾸려면 지웠다 다시 만들어야 한다.
--  컬럼을 지우면 그 위의 색인도 함께 사라지므로 색인도 다시 만든다.
-- ════════════════════════════════════════════════════════

ALTER TABLE gov_program ADD COLUMN IF NOT EXISTS body_text TEXT;

-- 이미 raw_document 에 원문이 있으므로 재수집 없이 채운다.
-- 같은 공고가 여러 run 에 걸쳐 여러 행일 수 있어 가장 최근에 받은 것만 쓴다.
UPDATE gov_program g
   SET body_text = latest.body
  FROM (
    SELECT DISTINCT ON (source_doc_id)
           source_doc_id,
           left(payload->>'_body', 2000) AS body
      FROM raw_document
     WHERE payload ? '_body'
       AND COALESCE(payload->>'_body', '') <> ''
     ORDER BY source_doc_id, fetched_at DESC
  ) AS latest
 WHERE latest.source_doc_id = g.source_doc_id
   AND g.body_text IS DISTINCT FROM latest.body;

ALTER TABLE gov_program DROP COLUMN IF EXISTS search_blob;

ALTER TABLE gov_program ADD COLUMN search_blob TEXT
  GENERATED ALWAYS AS (
    COALESCE(name, '')                              || ' ' ||
    COALESCE(field, '')                             || ' ' ||
    COALESCE(gov_tags_text(normalized_tags), '')    || ' ' ||
    COALESCE(summary, '')                           || ' ' ||
    COALESCE(agency, '')                            || ' ' ||
    COALESCE(body_text, '')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_gov_program_blob_trgm
  ON gov_program USING GIN (search_blob gin_trgm_ops);
