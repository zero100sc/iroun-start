/**
 * K-Startup 수집기.
 *
 * 계약(모든 수집기 공통):
 *   fetchPage({ client, config, apiKey, page, pageSize }) -> { rows, hasMore }
 *   normalize(row) -> gov_program 행 | null
 *
 * 러너는 이 두 함수만 알면 되므로, 소스를 추가할 때 러너를 고칠 일이 없다.
 */
const { mockKStartupResponse } = require('./mock-data');
const { normalizeKStartup } = require('./normalize');

/** 공공데이터포털 응답은 래핑 구조가 몇 가지로 갈린다 — 배열이 있는 곳을 찾아낸다. */
function extractRows(json) {
  if (Array.isArray(json)) return json;
  const candidates = [
    json?.data,
    json?.response?.body?.items,
    json?.response?.body?.items?.item,
    json?.body?.items,
    json?.items,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
    if (c && typeof c === 'object' && Array.isArray(c.item)) return c.item;
  }
  return [];
}

async function fetchPage({ client, config, apiKey, page, pageSize }) {
  // mock 모드일 때 러너가 apiKey 를 넘기지 않는다.
  if (!apiKey) {
    const start = (page - 1) * pageSize;
    const rows = mockKStartupResponse.slice(start, start + pageSize);
    return { rows, hasMore: start + pageSize < mockKStartupResponse.length };
  }

  const operation = config.operation || 'getAnnouncementInformation01';
  const url =
    `${config.baseUrl}/${operation}` +
    `?serviceKey=${encodeURIComponent(apiKey)}` +
    `&page=${page}&perPage=${pageSize}&returnType=JSON`;

  const { status, text } = await client.get(url);
  if (status !== 200) throw new Error(`K-Startup 응답 ${status}: ${text.slice(0, 200)}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // 키가 잘못되면 XML 에러 봉투가 오는 경우가 있어 원인을 그대로 노출한다.
    throw new Error(`K-Startup 응답이 JSON 이 아닙니다: ${text.slice(0, 200)}`);
  }

  const rows = extractRows(json);
  return { rows, hasMore: rows.length >= pageSize };
}

module.exports = { fetchPage, normalize: normalizeKStartup };
