/**
 * K-Startup 공고 API 응답 모형.
 *
 * API 키 없이도 수집 → 정규화 → 적재 전 과정을 돌려볼 수 있게 하는 용도.
 * 필드명은 공공데이터포털의 getAnnouncementInformation01 응답 규격을 따랐다.
 */
const mockKStartupResponse = [
  {
    pbanc_sn: '174250',
    biz_pbanc_nm: '2026년 예비창업패키지 예비창업자 모집 공고',
    pbanc_ctnt:
      '혁신적인 기술창업 아이디어를 보유한 예비창업자를 발굴하여 사업화 자금과 창업교육, ' +
      '멘토링을 지원합니다. 사업자등록 전인 예비창업자를 대상으로 하며 최대 1억원의 사업화 자금을 지원합니다.',
    supt_biz_clsfc: '사업화',
    aply_trgt_ctnt: '예비창업자(사업자등록 전), 전국',
    supt_regin: '전국',
    pbanc_ntrp_nm: '창업진흥원',
    pbanc_rcpt_bgng_dt: '20260301',
    pbanc_rcpt_end_dt: '20260331',
    detl_pg_url: 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=174250',
  },
  {
    pbanc_sn: '174311',
    biz_pbanc_nm: '2026년 청년창업사관학교 입교생 모집',
    pbanc_ctnt:
      '만 39세 이하 청년 창업자를 대상으로 창업 공간, 사업화 자금, 전담 멘토링을 통합 지원합니다. ' +
      '창업 3년 이내 기업 및 예비창업자가 신청할 수 있으며 최대 1억원을 지원합니다.',
    supt_biz_clsfc: '사업화',
    aply_trgt_ctnt: '만 39세 이하 청년 예비창업자 및 창업 3년 이내 기업',
    supt_regin: '전국',
    pbanc_ntrp_nm: '중소벤처기업진흥공단',
    pbanc_rcpt_bgng_dt: '20260210',
    pbanc_rcpt_end_dt: '20260228',
    detl_pg_url: 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=174311',
  },
  {
    pbanc_sn: '174402',
    biz_pbanc_nm: '2026년 여성창업 활성화 지원사업 참여기업 모집',
    pbanc_ctnt:
      '여성 예비창업자 및 초기창업기업을 대상으로 창업 전 과정을 맞춤 지원합니다. ' +
      '최대 5,000만원 규모의 사업화 자금과 여성 창업 전담 컨설팅을 제공합니다.',
    supt_biz_clsfc: '사업화',
    aply_trgt_ctnt: '여성 예비창업자 및 창업 3년 이내 여성기업',
    supt_regin: '서울특별시',
    pbanc_ntrp_nm: '여성기업종합지원센터',
    pbanc_rcpt_bgng_dt: '20260401',
    pbanc_rcpt_end_dt: '20260430',
    detl_pg_url: 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=174402',
  },
  {
    pbanc_sn: '174588',
    biz_pbanc_nm: '2026년 초기창업패키지 창업기업 모집공고',
    pbanc_ctnt:
      '창업 3년 이내 초기창업기업의 시제품 제작과 시장 진입을 지원합니다. ' +
      '전문 액셀러레이터와 연계한 집중 보육 프로그램을 운영하며 최대 1억원을 지원합니다.',
    supt_biz_clsfc: '사업화',
    aply_trgt_ctnt: '창업 3년 이내 기업',
    supt_regin: '경기도',
    pbanc_ntrp_nm: '창업진흥원',
    pbanc_rcpt_bgng_dt: '20260315',
    pbanc_rcpt_end_dt: '20260415',
    detl_pg_url: 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=174588',
  },
  {
    pbanc_sn: '174699',
    biz_pbanc_nm: '2026년 중장년 기술창업센터 입주기업 모집',
    pbanc_ctnt:
      '만 40세 이상 중장년 예비창업자 및 창업 7년 이내 기업의 기술창업을 지원합니다. ' +
      '퇴직 인력의 경력을 활용한 창업을 대상으로 최대 3천만원과 입주공간을 제공합니다.',
    supt_biz_clsfc: '사업화',
    aply_trgt_ctnt: '만 40세 이상 중장년 예비창업자, 창업 7년 이내 기업',
    supt_regin: '부산광역시',
    pbanc_ntrp_nm: '창업진흥원',
    pbanc_rcpt_bgng_dt: '20260220',
    pbanc_rcpt_end_dt: '20260320',
    detl_pg_url: 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=174699',
  },
];

module.exports = { mockKStartupResponse };
