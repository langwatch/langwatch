import type { SignInBreakGlassLimiter } from "../services/signin-router.service";

/**
 * audited"). already a per-process memo,
 * The budget on `?local=1` (ADR-117 §2: break-glass "is rate-limited,
 * A fixed window in process memory, deliberately. The gate ADR-027 froze is
 */
export const BREAK_GLASS_WINDOW_MS = 60_000;
export const BREAK_GLASS_WINDOW_BUDGET = 10;

export class InProcessBreakGlassLimiterAdapter implements SignInBreakGlassLimiter {
  private windowStartedAt = 0;
  private spent = 0;

  static create(options?: {
    clock?: () => number;
    windowMs?: number;
    budget?: number;
  }): InProcessBreakGlassLimiterAdapter {
    return new InProcessBreakGlassLimiterAdapter(
      options?.clock ?? Date.now,
      options?.windowMs ?? BREAK_GLASS_WINDOW_MS,
      options?.budget ?? BREAK_GLASS_WINDOW_BUDGET,
    );
  }

  constructor(
    private readonly clock: () => number = Date.now,
    private readonly windowMs: number = BREAK_GLASS_WINDOW_MS,
    private readonly budget: number = BREAK_GLASS_WINDOW_BUDGET,
  ) {}

  async allow(): Promise<boolean> {
    const now = this.clock();
    if (now - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = now;
      this.spent = 0;
    }
    if (this.spent >= this.budget) return false;
    this.spent += 1;
    return true;
  }
}
