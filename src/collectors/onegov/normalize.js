/**
 * OneGov 공개 API 응답 1건 → gov_program 행.
 *
 * OneGov 는 여러 정부 포털(K-Startup·기업마당·중기부 등)을 이미 수집·정규화해 둔
 * 2차 소스다. 우리는 그 위에서 '지원사업 매칭에 필요한 항목'만 다시 뽑아낸다.
 *
 * source_url 이 원 포털을 그대로 가리키므로, 사용자를 원본 공고로 보내는 데 문제가 없다.
 */
const {
  deriveClassification, parseAmount, parseDate, parsePeriodRange, inferAgency,
  extractLabeledField, extractStructuredHints,
} = require('../normalize/korean');

/** OneGov 가 출처를 특정하지 못했을 때 넣는 자리표시자 — 그대로 쓰면 안 된다. */
const AGGREGATE_PLACEHOLDER = '정부 공통(집계)';

const SOURCE_PORTAL = 'ONEGOV';

/** OneGov 의 id 는 UUID(36자) — 접두사를 붙여도 VARCHAR(50) 안에 들어간다. */
function buildProgramId(sourceDocId) {
  return `OG-${String(sourceDocId).slice(0, 44)}`;
}

function pick(row, ...keys) {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function normalizeOneGov(row) {
  const sourceDocId = pick(row, 'id');
  const title = pick(row, 'title');
  if (!sourceDocId || !title) return null;

  const summary = pick(row, 'summary');
  // fetchPage 가 /api/content/{id} 로 채워 넣는 본문. 마감일·금액이 여기 들어있다.
  const body = pick(row, '_body');
  const regionRaw = pick(row, 'region');

  // 자리표시자면 제목·본문에서 실제 기관을 되찾는다.
  const rawOrg = pick(row, 'org', 'ministry_name');
  const org = rawOrg && rawOrg !== AGGREGATE_PLACEHOLDER
    ? rawOrg
    : inferAgency({ title, summary, fallback: '' });

  // 분류에는 본문 전체가 아니라 "지원대상: …" 같은 라벨 줄만 넣는다.
  // 본문 전체를 넣으면 비용 항목에 스친 '기술개발비' 한 마디로 공고가 R&D 로 뒤집힌다.
  const hints = extractStructuredHints(body);
  const cls = deriveClassification({ title, summary, extra: hints });

  // 지역은 OneGov 가 이미 정규화해 둔 값을 우선 신뢰한다.
  const region = regionRaw ? deriveClassification({ title: regionRaw }).region : cls.region;

  // 마감일: featured 엔드포인트의 구조화 필드가 있으면 그것을, 없으면 본문에서 파싱.
  const structuredEnd = pick(row, 'deadline_at');
  const parsed = parsePeriodRange(body || summary);
  const periodEnd = structuredEnd ? parseDate(structuredEnd) : parsed.end;

  return {
    program_id: buildProgramId(sourceDocId),
    source_portal: SOURCE_PORTAL,
    source_doc_id: sourceDocId,
    name: title.slice(0, 200),
    agency: org ? org.slice(0, 100) : null, // 모르면 지어내지 않고 비워 둔다
    // 본문의 "지원분야:" 는 담당자가 직접 적은 값이라 추론보다 정확하다.
    field: (pick(row, 'support_field') || extractLabeledField(body, '지원분야') || cls.funding_type).slice(0, 100),
    target_stages: cls.target_stages,
    target_segments: cls.target_segments,
    target_industries: [],
    region,
    amount_text: extractAmountText(body || summary),
    max_amount: parseAmount(body) || parseAmount(summary) || parseAmount(title),
    funding_type: cls.funding_type,
    period_start: parsed.start,
    period_end: periodEnd,
    detail_url: pick(row, 'source_url'),
    summary: (summary || body).slice(0, 500),
    normalized_tags: cls.normalized_tags,
  };
}

function extractAmountText(text) {
  if (!text) return null;
  const m = text.match(/[^.\n]*?(?:최대|최고|이내)?\s*\d[\d,.]*\s*(?:억|천만|백만|만)\s*원[^.\n]*/);
  return m ? m[0].trim().slice(0, 120) : null;
}

module.exports = { normalizeOneGov, SOURCE_PORTAL, buildProgramId };
