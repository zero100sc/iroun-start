-- ════════════════════════════════════════════════════════
--  008 — OneGov 공개 API 를 수집 소스로 추가
--
--  https://korea-onegov.vercel.app/api — 인증 불필요(공개 API).
--  여러 정부 포털(K-Startup·기업마당·중기부 등)을 이미 수집·정규화해 둔 2차 소스라,
--  공공데이터포털 API 키 발급 없이도 즉시 실데이터를 받을 수 있다.
--
--  auth_env_var 를 NULL 로 두는 것이 핵심이다. 러너는 이 값이 NULL 이면
--  '인증이 필요 없는 소스'로 보고 --live 시 실제 호출한다.
--
--  config 의미:
--    category  /api/search 의 분류 필터. 'grant' = 지원사업 공고
--    sort      date_desc — 최신 공고부터 가져와 앞쪽 페이지만 돌려도 최신성이 유지된다
--    enrich    true = 건별로 /api/content/{id} 를 한 번 더 호출해 본문(마감일)을 채운다
--    pageSize  API 상한이 50
-- ════════════════════════════════════════════════════════

INSERT INTO ingestion_source (id, name, base_url, auth_env_var, rate_limit_per_min, mock_mode, enabled, kogl_type, config)
VALUES
  ('onegov',
   'OneGov 공개 API (정부 공고 통합)',
   'https://korea-onegov.vercel.app/api',
   NULL,
   60, FALSE, TRUE, 1,
   '{"category":"grant","sort":"date_desc","enrich":true,"pageSize":50,"sourcePortal":"ONEGOV",
     "allowHosts":["www.bizinfo.go.kr","www.k-startup.go.kr"]}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  base_url           = EXCLUDED.base_url,
  auth_env_var       = EXCLUDED.auth_env_var,
  rate_limit_per_min = EXCLUDED.rate_limit_per_min,
  config             = EXCLUDED.config;
