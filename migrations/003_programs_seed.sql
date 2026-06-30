-- ════════════════════════════════════════════════════════
--  003 — 정부지원사업 공고(STEP4 매칭) · canonical schema + 시드
--  PRD 4.3 Canonical Program Schema 기준(간소화).
--  ※ 시드 12건은 랜딩 공고 기반. 추후 크롤링 시스템 연동으로 교체 가능.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gov_program (
  program_id        VARCHAR(50) PRIMARY KEY,
  source_portal     VARCHAR(30),
  name              VARCHAR(200) NOT NULL,
  agency            VARCHAR(100),
  field             VARCHAR(100),                  -- 지원분야
  target_stages     TEXT[] NOT NULL DEFAULT '{}',  -- 예비/1년미만/1-3년/3-7년/소상공인
  target_segments   TEXT[] NOT NULL DEFAULT '{}',  -- 세그먼트 코드(segment_master)
  target_industries TEXT[] NOT NULL DEFAULT '{}',  -- 빈 배열 = 전체 업종 대상
  region            VARCHAR(50) NOT NULL DEFAULT '전국',
  amount_text       VARCHAR(120),
  max_amount        BIGINT,
  funding_type      VARCHAR(50),
  period_end        DATE,                           -- NULL = 상시
  detail_url        TEXT,
  summary           TEXT,
  normalized_tags   TEXT[] NOT NULL DEFAULT '{}',
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_program_segments   ON gov_program USING GIN (target_segments);
CREATE INDEX IF NOT EXISTS idx_program_stages     ON gov_program USING GIN (target_stages);

-- 매칭 결과 캐시(프로필×공고)
CREATE TABLE IF NOT EXISTS match_result (
  id               SERIAL PRIMARY KEY,
  profile_id       INT NOT NULL REFERENCES customer_profile(id) ON DELETE CASCADE,
  program_id       VARCHAR(50) NOT NULL REFERENCES gov_program(program_id) ON DELETE CASCADE,
  hard_filter_pass BOOLEAN,
  score            INT,
  score_breakdown  JSONB,
  evidence         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, program_id)
);

-- ── 시드: 예비창업자 트랙 ──
INSERT INTO gov_program
  (program_id, source_portal, name, agency, field, target_stages, target_segments, target_industries, region, amount_text, max_amount, funding_type, summary, normalized_tags)
VALUES
  ('KS-PRESTART','KSTARTUP','예비창업패키지','창업진흥원','사업화','{예비}','{PRE}','{}','전국','최대 1억원 (사업화 자금)',100000000,'사업화','아이디어만 있다면 신청 가능. 사업화 자금 및 교육·멘토링 제공.','{예비창업,사업화,멘토링}'),
  ('SBC-YOUTH','KSTARTUP','청년창업사관학교','중소기업진흥공단','사업화','{예비,1년미만}','{YOUTH,PRE}','{}','전국','최대 1억원 + 창업 공간',100000000,'사업화','만 39세 이하 청년 예비창업자. 창업 공간·멘토링·사업화 자금 통합 지원.','{청년,사업화,공간}'),
  ('KS-EARLY','KSTARTUP','초기창업패키지','창업진흥원','사업화','{예비,1년미만,1-3년}','{EARLY,PRE}','{}','전국','최대 1억원',100000000,'사업화','창업 3년 이내(예비 포함). 전문 액셀러레이터 연계 집중 보육.','{초기창업,보육}'),
  ('WBIZ-WOMAN','WBIZ','여성창업패키지','여성기업종합지원센터','사업화','{예비,1년미만}','{WOMAN}','{}','전국','최대 5,000만원',50000000,'사업화','여성 예비·초기창업자 대상 창업 전 과정 맞춤형 지원.','{여성,사업화}'),
  ('KS-SOCIAL','KSTARTUP','소셜벤처 창업지원','창업진흥원','사업화','{예비,1년미만}','{PRE,EARLY}','{}','전국','최대 7,000만원',70000000,'사업화','사회적 가치를 추구하는 예비창업자 전용 지원 트랙.','{소셜벤처,사회적가치}'),
  ('LOCAL-YOUTH','BIZINFO','지역 청년 창업 지원','시·도 경제진흥원','사업화','{예비,1년미만}','{YOUTH}','{}','지역','지역별 상이 (평균 2천~5천만원)',50000000,'사업화','지역별 청년 창업자를 위한 공간·자금·교육 지원.','{청년,지역}'),

-- ── 시드: 소상공인 트랙 ──
  ('SBIZ-LOAN','SBIZ24','소상공인 정책자금(직접대출)','소상공인시장진흥공단','융자','{소상공인}','{SMB,LOAN}','{}','전국','최대 7,000만원 · 금리 2.5~3.5%',70000000,'융자','저금리 운영·시설자금 직접 융자. 시중 대비 2~3%p 낮은 금리.','{정책자금,저금리,융자}'),
  ('SBIZ-GROWTH','SBIZ24','소상공인 성장지원 자금','소상공인시장진흥공단','융자','{소상공인}','{SMB}','{}','전국','최대 1억원 · 금리 우대',100000000,'융자','성장 가능성 있는 소상공인 대상 우대 금리 융자.','{성장,융자}'),
  ('SBIZ-SMART','SBIZ24','스마트 소상공인 지원','소상공인시장진흥공단','디지털전환','{소상공인}','{SMB}','{}','전국','최대 500만원 (도입비 50%)',5000000,'디지털전환','키오스크·POS·배달앱 등 디지털 전환 비용 지원.','{디지털전환,키오스크}'),
  ('KIBO-GUAR','BIZINFO','소상공인 특례보증','신용보증기금·기술보증기금','보증','{소상공인}','{SMB,LOAN}','{}','전국','최대 1억원 보증',100000000,'보증','신용등급이 낮아도 보증 지원으로 대출 가능. 무담보.','{특례보증,무담보}'),
  ('NOMU-INS','BIZINFO','노란우산공제','중소기업중앙회','공제','{소상공인}','{SMB}','{}','전국','연 최대 500만원 소득공제',5000000,'공제','폐업·사망 시 생활안정 공제금 지급. 세금 혜택.','{노란우산,소득공제}'),
  ('SBIZ-RECOVER','SBIZ24','경영위기 소상공인 재기지원','소상공인시장진흥공단','컨설팅','{소상공인}','{SMB}','{}','전국','컨설팅 무료 + 재기자금 연계',0,'재기지원','폐업위기 소상공인 경영컨설팅·채무조정·재창업 지원.','{재기,컨설팅}')
ON CONFLICT (program_id) DO NOTHING;
