/**
 * A sliding-window request counter, one per caller address.
 *
 * Checking and recording are separate calls because the endpoint decides
 * whether a request counts against the window only after it knows what the
 * request was: a well-formed call that simply failed authentication is
 * tracked, a malformed one is not.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export class McpRateLimitService {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor({ windowMs, maxRequests }: { windowMs: number; maxRequests: number }) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /** Whether the address has already spent its window. Does not record. */
  isBlocked(ip: string): boolean {
    const entry = this.entries.get(ip);
    if (!entry || Date.now() - entry.windowStart > this.windowMs) return false;
    return entry.count >= this.maxRequests;
  }

  /** Records one request for this address. */
  track(ip: string): void {
    const now = Date.now();
    const entry = this.entries.get(ip);
    if (!entry || now - entry.windowStart > this.windowMs) {
      this.entries.set(ip, { count: 1, windowStart: now });
      return;
    }
    entry.count++;
  }

  /** Drops windows that have elapsed, so an idle address costs nothing. */
  sweep(): void {
    const now = Date.now();
    for (const [ip, entry] of this.entries) {
      if (now - entry.windowStart > this.windowMs) this.entries.delete(ip);
    }
  }

  /** Forgets every address. */
  clear(): void {
    this.entries.clear();
  }
}
