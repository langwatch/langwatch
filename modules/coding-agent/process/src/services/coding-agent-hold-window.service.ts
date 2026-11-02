export const CODING_AGENT_SESSION_SEEN_WINDOW_MS = 5 * 60 * 1000;
export const HOLD_SWEEP_THRESHOLD = 10_000;

/** In-memory throttle: a key is held for one window after it is claimed, until released. */
export class CodingAgentHoldWindowService {
  private readonly heldUntil = new Map<string, number>();

  private constructor() {}

  static create(): CodingAgentHoldWindowService {
    return new CodingAgentHoldWindowService();
  }

  /** Drops expired holds once the map is large, so it cannot grow without bound. */
  sweepIfLarge(now: number): void {
    if (this.heldUntil.size < HOLD_SWEEP_THRESHOLD) return;
    for (const [key, until] of this.heldUntil) {
      if (until <= now) this.heldUntil.delete(key);
    }
  }

  isHeld(key: string, now: number): boolean {
    return (this.heldUntil.get(key) ?? 0) > now;
  }

  /** Returns the expiry it set, which `release` needs to undo only its own hold. */
  hold(key: string, now: number): number {
    const until = now + CODING_AGENT_SESSION_SEEN_WINDOW_MS;
    this.heldUntil.set(key, until);
    return until;
  }

  /** A newer hold on the same key is left alone. */
  release(key: string, heldTo: number): void {
    if (this.heldUntil.get(key) === heldTo) this.heldUntil.delete(key);
  }
}
