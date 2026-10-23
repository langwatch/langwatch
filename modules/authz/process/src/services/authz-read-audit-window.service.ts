/** ADR-177 decision 9 and ADR-185 §8: one read audit per key per five minutes. */
export const READ_AUDIT_WINDOW_MS = 5 * 60 * 1000;

/** Bound on remembered keys; only caps memory, the window does the rest. */
const MAX_REMEMBERED_READS = 10_000;

/**
 * A per-process window over read audits: repeat and concurrent reads of one key send once; a
 * failed send is passed on and not remembered. What a key means is the caller's.
 */
export class AuthzReadAuditWindowService {
  static create({
    windowMs = READ_AUDIT_WINDOW_MS,
    now = Date.now,
  }: { windowMs?: number; now?: () => number } = {}): AuthzReadAuditWindowService {
    return new AuthzReadAuditWindowService(windowMs, now);
  }

  /** Key to the time its window closes. */
  readonly #recorded = new Map<string, number>();
  readonly #inFlight = new Map<string, Promise<void>>();

  private constructor(
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  once({ key, send }: { key: string; send: () => Promise<void> }): Promise<void> {
    const closesAt = this.#recorded.get(key);
    if (closesAt !== undefined) {
      if (this.now() < closesAt) return Promise.resolve();
      this.#recorded.delete(key);
    }
    const pending = this.#inFlight.get(key);
    if (pending) return pending;

    const flight = send()
      .then(() => this.remember(key))
      .finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, flight);
    return flight;
  }

  private remember(key: string): void {
    if (this.#recorded.size >= MAX_REMEMBERED_READS) {
      const oldest = this.#recorded.keys().next().value;
      if (oldest !== undefined) this.#recorded.delete(oldest);
    }
    this.#recorded.set(key, this.now() + this.windowMs);
  }
}
