/**
 * 수집기 공용 HTTP 클라이언트.
 *
 * 타임아웃 · 지수 백오프 재시도 · 유량 제한을 한곳에 모았다.
 * 개별 수집기는 이 함수만 쓰고 네트워크 예외 처리를 신경 쓰지 않는다.
 */
const { RateLimiter } = require('./rate-limiter');

// HTTP 헤더 값은 ByteString(ASCII)만 허용된다 — 한글을 넣으면 fetch 가 즉시 던진다.
const USER_AGENT = 'iroun-start-collector/1.0 (+gov grant announcement collector)';

/** 5xx·429·네트워크 오류만 재시도한다. 4xx 는 요청 자체가 틀린 것이므로 즉시 실패. */
function isRetryable(status) {
  return status === 429 || (status >= 500 && status < 600);
}

class HttpClient {
  constructor({ ratePerMin = 30, timeoutMs = 20000, maxRetries = 3 } = {}) {
    this.limiter = new RateLimiter(ratePerMin);
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
  }

  /**
   * @param {string} url
   * @returns {Promise<{status:number, text:string}>}
   */
  async get(url) {
    let lastErr;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.limiter.wait();

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);

      try {
        const res = await fetch(url, {
          signal: ac.signal,
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/xml, */*' },
        });
        const text = await res.text();

        if (!res.ok && isRetryable(res.status) && attempt < this.maxRetries) {
          lastErr = new Error(`HTTP ${res.status}`);
          await backoff(attempt);
          continue;
        }
        return { status: res.status, text };
      } catch (err) {
        // AbortError(타임아웃) 포함 — 네트워크 계열은 재시도 대상
        lastErr = err;
        if (attempt < this.maxRetries) {
          await backoff(attempt);
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`요청 실패(${this.maxRetries + 1}회 시도): ${url} — ${lastErr && lastErr.message}`);
  }
}

/** 1초 → 2초 → 4초 (±20% 지터로 동시 재시도가 겹치지 않게) */
function backoff(attempt) {
  const base = 1000 * Math.pow(2, attempt);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return new Promise((r) => setTimeout(r, base + jitter));
}

module.exports = { HttpClient, USER_AGENT };
