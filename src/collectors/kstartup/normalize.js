/**
 * K-Startup 응답 1건 → gov_program 행.
 *
 * 필드 매핑만 담당하고, 업력·세그먼트·지역 판단은 normalize/korean.js 에 위임한다.
 * (수집기가 늘어나도 분류 규칙은 한곳에서만 고치면 되도록)
 */
const { deriveClassification, parseAmount, parseDate } = require('../normalize/korean');

const SOURCE_PORTAL = 'KSTARTUP';

/** 외부 공고 ID → program_id. VARCHAR(50) 안에 들어가야 한다. */
function buildProgramId(sourceDocId) {
  return `KS-${String(sourceDocId).slice(0, 44)}`;
}

/** 응답 필드명이 버전에 따라 흔들려도 견디도록 후보를 순서대로 본다. */
function pick(row, ...keys) {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function normalizeKStartup(row) {
  const sourceDocId = pick(row, 'pbanc_sn', 'pbancSn', 'id');
  if (!sourceDocId) return null; // ID 없는 행은 재수집 시 중복을 만들므로 버린다

  const title = pick(row, 'biz_pbanc_nm', 'bizPbancNm', 'title');
  if (!title) return null;

  const body = pick(row, 'pbanc_ctnt', 'pbancCtnt', 'summary');
  const target = pick(row, 'aply_trgt_ctnt', 'aplyTrgtCtnt');
  const regionRaw = pick(row, 'supt_regin', 'suptRegin');
  const agency = pick(row, 'pbanc_ntrp_nm', 'pbancNtrpNm') || '창업진흥원';
  const field = pick(row, 'supt_biz_clsfc', 'suptBizClsfc');

  // 분류는 제목·본문·신청대상을 한 덩어리로 보고 판단한다.
  const cls = deriveClassification({ title, summary: body, extra: `${target} ${regionRaw}` });

  // 지역은 전용 필드가 있으면 그쪽을 우선(본문에 섞인 지명에 오염되지 않도록)
  const region = regionRaw ? deriveClassification({ title: regionRaw }).region : cls.region;

  return {
    program_id: buildProgramId(sourceDocId),
    source_portal: SOURCE_PORTAL,
    source_doc_id: sourceDocId,
    name: title.slice(0, 200),
    agency: agency.slice(0, 100),
    field: (field || cls.funding_type).slice(0, 100),
    target_stages: cls.target_stages,
    target_segments: cls.target_segments,
    target_industries: [], // 빈 배열 = 전체 업종 (003 스키마 주석 규약)
    region,
    amount_text: extractAmountText(body),
    max_amount: parseAmount(body) || parseAmount(title),
    funding_type: cls.funding_type,
    period_start: parseDate(pick(row, 'pbanc_rcpt_bgng_dt', 'pbancRcptBgngDt')),
    period_end: parseDate(pick(row, 'pbanc_rcpt_end_dt', 'pbancRcptEndDt')),
    detail_url: pick(row, 'detl_pg_url', 'detlPgUrl'),
    summary: body.slice(0, 500),
    normalized_tags: cls.normalized_tags,
  };
}

/** 본문에서 금액이 언급된 문장 조각을 그대로 보존(사용자에게 보여줄 원문 표기). */
function extractAmountText(body) {
  if (!body) return null;
  const m = body.match(/[^.]*?(?:최대|최고|이내)?\s*\d[\d,.]*\s*(?:억|천만|백만|만)\s*원[^.]*/);
  return m ? m[0].trim().slice(0, 120) : null;
}

module.exports = { normalizeKStartup, SOURCE_PORTAL, buildProgramId };
