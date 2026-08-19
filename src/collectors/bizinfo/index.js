/**
 * 기업마당(bizinfo) 수집기. 계약은 kstartup 과 동일하다.
 */
const { mockBizinfoResponse } = require('./mock-data');
const { normalizeBizinfo } = require('./normalize');

function extractRows(json) {
  if (Array.isArray(json)) return json;
  const candidates = [
    json?.jsonArray,          // 기업마당 오픈API 가 쓰는 래핑
    json?.response?.body?.items,
    json?.body?.items,
    json?.items,
    json?.data,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
    if (c && typeof c === 'object' && Array.isArray(c.item)) return c.item;
  }
  return [];
}

async function fetchPage({ client, config, apiKey, page, pageSize }) {
  if (!apiKey) {
    const start = (page - 1) * pageSize;
    const rows = mockBizinfoResponse.slice(start, start + pageSize);
    return { rows, hasMore: start + pageSize < mockBizinfoResponse.length };
  }

  const operation = config.operation || 'getbizList';
  const url =
    `${config.baseUrl}/${operation}` +
    `?serviceKey=${encodeURIComponent(apiKey)}` +
    `&pageNo=${page}&numOfRows=${pageSize}&dataType=json`;

  const { status, text } = await client.get(url);
  if (status !== 200) throw new Error(`기업마당 응답 ${status}: ${text.slice(0, 200)}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`기업마당 응답이 JSON 이 아닙니다: ${text.slice(0, 200)}`);
  }

  const rows = extractRows(json);
  return { rows, hasMore: rows.length >= pageSize };
}

module.exports = { fetchPage, normalize: normalizeBizinfo };
