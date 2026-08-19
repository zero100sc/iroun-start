/**
 * OneGov API 응답 모형 — 2026-08-17 실제 응답에서 필드 구조를 그대로 옮겼다.
 * (_body 는 /api/content/{id} 로 보강된 뒤의 상태를 재현한 것)
 */
const mockOneGovResponse = [
  {
    id: '8e12d274-225b-41b3-9157-7d31bec2f406',
    doc_type: 'notice',
    title: '2026년 특허출원·등록 비용 바우처 지원사업 11차(하반기 4차)',
    summary:
      '(사)한국중소기업발전협회의 2026년 특허출원·등록 비용 바우처 지원사업 시행계획을 다음과 같이 공고하오니, ' +
      '동 사업에 참여하여 지원을 받고자 하는 기업은 안내에 따라 신청하시기 바랍니다. ' +
      '지원분야: 사업화 지원대상: 대학,연구기관,일반기업,1인 창조기업 / 스타트업, 중소기업, 1인기업, 예비창업자, 대학 및 기관 등',
    ministry_name: '정부 공통(집계)',
    category: 'grant',
    published_at: '2026-08-17T00:00:00+09:00',
    source_url: 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=178870',
    region: '전국',
    kogl_type: 1,
    _body: '접수기간: 2026.08.17 ~ 2026.08.31\n지원분야: 사업화\n지원내용: 특허출원 비용의 70% 이내, 건당 최대 300만원 지원',
  },
  {
    id: 'c23a25bb-fd79-4b4b-9ea5-3e3570ddccd4',
    doc_type: 'notice',
    title: '[경북] 2026년 해양기업 맞춤형 역량강화 컨설팅 프로그램 지원기업 모집 공고',
    summary: '경상북도 해양기업의 경영 역량 강화를 위한 맞춤형 컨설팅을 지원합니다.',
    ministry_name: '경상북도',
    org: '경상북도',
    category: 'grant',
    published_at: '2026-08-10T00:00:00+09:00',
    source_url: 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000125386',
    region: '경북',
    kogl_type: 1,
    support_field: '경영 > 컨설팅',
    deadline_at: '2026-08-17T23:59:59+09:00',
    _body: '접수기간: 2026.08.01 ~ 2026.08.17\n지원대상: 도내 소상공인 및 중소기업\n지원내용: 기업당 최대 500만원 상당 컨설팅',
  },
  {
    id: 'a71f0c92-8d33-4f10-9b02-6c1e7a4d5522',
    doc_type: 'notice',
    title: '2026년 청년창업 사업화 지원사업 참여기업 모집',
    summary: '만 39세 이하 청년 예비창업자 및 창업 3년 이내 기업의 사업화를 지원합니다.',
    ministry_name: '중소벤처기업부',
    category: 'grant',
    published_at: '2026-08-12T00:00:00+09:00',
    source_url: 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=178901',
    region: '전국',
    kogl_type: 1,
    _body: '접수기간: 2026.08.12 ~ 2026.09.15\n지원대상: 만 39세 이하 청년 예비창업자, 창업 3년 이내 기업\n지원내용: 기업당 최대 1억원의 사업화 자금',
  },
];

module.exports = { mockOneGovResponse };
