/**
 * OneGov 공개 API 수집기 — https://korea-onegov.vercel.app/api
 *
 * 인증이 필요 없어 API 키 발급 없이 바로 실데이터를 받을 수 있다.
 *
 * 두 엔드포인트를 쓰는 이유:
 *  · /api/search?category=grant  — 유일하게 페이지네이션이 되는 목록 (총 4만건대)
 *  · /api/content/{id}           — 마감일이 여기 본문에만 있다. 목록 응답에는 없음.
 *
 * (/api/grant/featured 는 마감일이 구조화돼 있지만 page 가 무시되고 24건이 상한이라
 *  전량 수집에는 쓸 수 없다 — 2026-08-17 실측)
 */
const { mockOneGovResponse } = require('./mock-data');
const { normalizeOneGov } = require('./normalize');

async function fetchPage({ client, config, page, pageSize }) {
  const base = config.baseUrl || 'https://korea-onegov.vercel.app/api';

  if (config.useMock) {
    const start = (page - 1) * pageSize;
    const rows = mockOneGovResponse.slice(start, start + pageSize);
    return { rows, hasMore: start + pageSize < mockOneGovResponse.length };
  }

  const size = Math.min(pageSize, 50); // API 상한
  const category = config.category || 'grant';
  const sort = config.sort || 'date_desc';

  const listUrl = `${base}/search?category=${encodeURIComponent(category)}&size=${size}&page=${page}&sort=${sort}`;
  const { status, text } = await client.get(listUrl);
  if (status !== 200) throw new Error(`OneGov 목록 응답 ${status}: ${text.slice(0, 200)}`);

  const json = JSON.parse(text);
  const raw = Array.isArray(json.results) ? json.results : [];

  // ── 기간 절단 (config.since) ──
  // 목록이 published_at 내림차순이므로, 경계보다 오래된 문서가 처음 나온 페이지가
  // 곧 마지막 페이지다. 여기서 hasMore 를 끊어 그 이전 연도를 긁지 않는다.
  let reachedCutoff = false;
  let scoped = raw;
  if (config.since) {
    const cutoff = new Date(config.since).getTime();
    scoped = raw.filter((r) => {
      const t = new Date(r.published_at).getTime();
      if (Number.isNaN(t)) return true;      // 날짜가 깨진 건은 버리지 않고 통과시킨다
      return t >= cutoff;
    });
    if (scoped.length < raw.length) reachedCutoff = true;
  }

  // ── 조달 입찰공고 걸러내기 ──
  // category=grant 는 이름과 달리 나라장터(g2b) 입찰공고를 함께 담는다.
  // 2026-08-17 실측: 200건 표본 중 157건(78.5%)이 g2b — "리모델링공사", "차량 임차용역" 등
  // 창업·소상공인 지원사업과 무관한 문서다. 출처 호스트가 가장 깨끗한 판별 기준이었다.
  // (제목 키워드로 거르면 '용역'이 들어간 정상 지원사업까지 날아간다)
  const allowHosts = config.allowHosts;
  const results = allowHosts && allowHosts.length
    ? scoped.filter((r) => allowHosts.some((h) => String(r.source_url || '').includes(h)))
    : scoped;

  // 본문 보강 — 마감일이 목록에 없어 건별로 상세를 한 번씩 더 부른다.
  // 반드시 위 필터 뒤에 둔다(걸러질 문서까지 상세를 부르면 요청이 5배로 뛴다).
  if (config.enrich !== false) {
    for (const row of results) {
      try {
        const { status: s, text: t } = await client.get(`${base}/content/${encodeURIComponent(row.id)}`);
        if (s === 200) row._body = JSON.parse(t).body || '';
      } catch (err) {
        // 상세 실패는 치명적이지 않다 — 마감일 없이 목록 정보만으로 적재한다.
        row._body = '';
      }
    }
  }

  // hasMore 는 필터 전 원본 길이로 판단해야 한다.
  // 이 페이지가 전부 걸러져 0건이어도 다음 페이지에는 지원사업이 있을 수 있다.
  const hasMore = !reachedCutoff && raw.length >= size && page * size < (json.total || 0);
  return { rows: results, hasMore };
}

module.exports = { fetchPage, normalize: normalizeOneGov };
