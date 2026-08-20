/**
 * Gemini 클라이언트 — 이 파일 하나만 모델을 안다.
 *
 * 모델은 예고 없이 은퇴한다. 2026-08-20 에 코드에 박혀 있던 gemini-1.5-flash 가
 * 404 인 것을 발견했는데, AI 아이템명 생성과 검색 분야 확장이 같은 이름을 각자
 * 하드코딩하고 있었다. 그래서 한 곳이 죽으면 조용히 둘 다 죽었다.
 * 이름을 여기 한 곳에 두고 환경변수로 덮을 수 있게 한다(.env.example 참고).
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

/**
 * 모델 핸들. 키가 없으면 null 을 준다 — 호출부는 그때 목업으로 떨어지면 된다.
 * @param {object} [generationConfig]
 */
function getModel(generationConfig) {
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      .getGenerativeModel(generationConfig ? { model: GEMINI_MODEL, generationConfig }
                                           : { model: GEMINI_MODEL });
  } catch {
    return null;
  }
}

/**
 * 시간 제한을 건 생성 호출.
 *
 * SDK 는 기본 타임아웃이 없다. 구글 쪽이 오류를 주지 않고 그냥 멈추면 호출부가
 * 영원히 기다리는데, 이게 사용자 요청 경로 안이면 검색 자체가 응답하지 않는다.
 * 그래서 예산을 정하고 초과하면 포기한다 — AI 는 있으면 좋은 것이지 필수가 아니다.
 */
async function generateWithTimeout(model, prompt, ms = 3000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini 응답이 ${ms}ms 를 넘겨 포기함`)), ms);
  });
  try {
    return await Promise.race([model.generateContent(prompt), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { GEMINI_MODEL, getModel, generateWithTimeout };
