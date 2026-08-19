/**
 * 분당 요청 수 제한기.
 *
 * 공공 API 는 대개 트래픽 초과 시 계정 단위로 차단한다. 소스별 rate_limit_per_min 을
 * 지켜 호출 간격을 강제로 벌린다(토큰 버킷이 아니라 균등 간격 방식 — 순간적으로
 * 몰아치지 않는 쪽이 상대 서버에 예의 바르고, 차단당할 확률도 낮다).
 */
class RateLimiter {
  constructor(perMinute) {
    this.intervalMs = Math.ceil(60000 / Math.max(1, perMinute));
    this.lastAt = 0;
  }

  /** 직전 호출로부터 최소 intervalMs 가 지나도록 대기한다. */
  async wait() {
    const now = Date.now();
    const waitMs = this.lastAt + this.intervalMs - now;
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    this.lastAt = Date.now();
  }
}

module.exports = { RateLimiter };
