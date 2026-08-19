/**
 * 기업마당(bizinfo) 지원사업 공고 응답 모형.
 * 소상공인·정책자금 계열이 많아 K-Startup 과 세그먼트 분포가 다르다.
 */
const mockBizinfoResponse = [
  {
    pblancId: 'PBLN_000000000098765',
    pblancNm: '2026년 소상공인 정책자금(직접대출) 신청 안내',
    bsnsSumryCn:
      '소상공인의 경영 안정을 위해 저금리 운영자금 및 시설자금을 직접 융자합니다. ' +
      '업체당 최대 7,000만원까지 지원하며 금리는 연 2.5~3.5% 수준입니다.',
    jrsdInsttNm: '소상공인시장진흥공단',
    excInsttNm: '중소벤처기업부',
    pldirSportRealmLclasCodeNm: '금융',
    trgetNm: '소상공인',
    areaNm: '전국',
    reqstBeginEndDe: '20260105 ~ 20261231',
    pblancUrl: 'https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=PBLN_000000000098765',
  },
  {
    pblancId: 'PBLN_000000000098801',
    pblancNm: '2026년 스마트 소상공인 디지털 전환 지원사업',
    bsnsSumryCn:
      '소상공인의 키오스크·POS·배달앱 등 디지털 장비 도입 비용을 지원합니다. ' +
      '도입비의 50% 이내에서 업체당 최대 500만원을 지원합니다.',
    jrsdInsttNm: '소상공인시장진흥공단',
    excInsttNm: '중소벤처기업부',
    pldirSportRealmLclasCodeNm: '기술',
    trgetNm: '소상공인',
    areaNm: '전국',
    reqstBeginEndDe: '20260302 ~ 20260430',
    pblancUrl: 'https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=PBLN_000000000098801',
  },
  {
    pblancId: 'PBLN_000000000098902',
    pblancNm: '2026년 중소기업 기술개발(R&D) 지원사업 신규과제 공고',
    bsnsSumryCn:
      '중소기업의 기술개발 과제를 지원합니다. 창업 7년 이내 기업을 우대하며 ' +
      '과제당 최대 2억원의 연구개발비를 최대 2년간 지원합니다.',
    jrsdInsttNm: '중소기업기술정보진흥원',
    excInsttNm: '중소벤처기업부',
    pldirSportRealmLclasCodeNm: '기술',
    trgetNm: '중소기업',
    areaNm: '전국',
    reqstBeginEndDe: '20260210 ~ 20260325',
    pblancUrl: 'https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=PBLN_000000000098902',
  },
  {
    pblancId: 'PBLN_000000000099013',
    pblancNm: '2026년 소상공인 특례보증 지원 안내',
    bsnsSumryCn:
      '신용등급이 낮아 대출이 어려운 소상공인에게 무담보 특례보증을 제공합니다. ' +
      '업체당 최대 1억원까지 보증하며 보증료를 감면합니다.',
    jrsdInsttNm: '신용보증재단중앙회',
    excInsttNm: '중소벤처기업부',
    pldirSportRealmLclasCodeNm: '금융',
    trgetNm: '소상공인',
    areaNm: '경기도',
    reqstBeginEndDe: '20260101 ~ 20261231',
    pblancUrl: 'https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=PBLN_000000000099013',
  },
];

module.exports = { mockBizinfoResponse };
