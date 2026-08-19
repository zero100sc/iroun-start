/**
 * 기업마당 응답 1건 → gov_program 행.
 */
const { deriveClassification, parseAmount, parseDate } = require('../normalize/korean');

const SOURCE_PORTAL = 'BIZINFO';

function buildProgramId(sourceDocId) {
  // PBLN_000000000098765 처럼 길어서 접두 0 을 걷어내 50자 제한 안에 넣는다.
  const compact = String(sourceDocId).replace(/^PBLN_0*/, '');
  return `BZ-${compact.slice(0, 44)}`;
}

function pick(row, ...keys) {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** "20260105 ~ 20261231" 형태의 접수기간을 시작/종료로 쪼갠다. */
function splitPeriod(raw) {
  if (!raw) return { start: null, end: null };
  const parts = String(raw).split(/~|-(?=\s*\d{4})|부터|까지/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { start: parseDate(parts[0]), end: parseDate(parts[1]) };
  return { start: parseDate(parts[0]), end: null };
}

function normalizeBizinfo(row) {
  const sourceDocId = pick(row, 'pblancId', 'pblanc_id');
  if (!sourceDocId) return null;

  const title = pick(row, 'pblancNm', 'pblanc_nm');
  if (!title) return null;

  const body = pick(row, 'bsnsSumryCn', 'bsns_sumry_cn');
  const target = pick(row, 'trgetNm', 'trget_nm');
  const regionRaw = pick(row, 'areaNm', 'area_nm');
  const agency = pick(row, 'jrsdInsttNm', 'jrsd_instt_nm', 'excInsttNm') || '중소벤처기업부';
  const field = pick(row, 'pldirSportRealmLclasCodeNm');

  const cls = deriveClassification({ title, summary: body, extra: `${target} ${regionRaw}` });
  const region = regionRaw ? deriveClassification({ title: regionRaw }).region : cls.region;
  const { start, end } = splitPeriod(pick(row, 'reqstBeginEndDe', 'reqst_begin_end_de'));

  return {
    program_id: buildProgramId(sourceDocId),
    source_portal: SOURCE_PORTAL,
    source_doc_id: sourceDocId,
    name: title.slice(0, 200),
    agency: agency.slice(0, 100),
    field: (field || cls.funding_type).slice(0, 100),
    target_stages: cls.target_stages,
    target_segments: cls.target_segments,
    target_industries: [],
    region,
    amount_text: extractAmountText(body),
    max_amount: parseAmount(body) || parseAmount(title),
    funding_type: cls.funding_type,
    period_start: start,
    period_end: end,
    detail_url: pick(row, 'pblancUrl', 'pblanc_url'),
    summary: body.slice(0, 500),
    normalized_tags: cls.normalized_tags,
  };
}

function extractAmountText(body) {
  if (!body) return null;
  const m = body.match(/[^.]*?(?:최대|최고|이내)?\s*\d[\d,.]*\s*(?:억|천만|백만|만)\s*원[^.]*/);
  return m ? m[0].trim().slice(0, 120) : null;
}

module.exports = { normalizeBizinfo, SOURCE_PORTAL, buildProgramId };
