import type { SignInBreakGlassLimiter } from "@langwatch/identity-server";

/**
 * The budget on `?local=1` (ADR-117 §2: break-glass "is rate-limited,
 * audited").
 *
 * A fixed window in process memory, deliberately. The gate ADR-027 froze is
 * already a per-process memo, break-glass is an operator action measured in
 * ones per incident rather than per pod, and a Redis round trip in front of
 * the door that exists FOR the days the infrastructure is broken would defeat
 * the door. Per-pod counting means a fleet of N pods allows N budgets; the
 * budget is small enough that this is still a limit and not a formality.
 *
 * Spending the budget never refuses anyone. It only stops the parameter from
 * bypassing an auto-redirect, so a spray of `?local=1` against an SSO-only
 * deployment routes to the IdP like any other request — see the port's
 * docblock in `@langwatch/identity-server`.
 */
export const BREAK_GLASS_WINDOW_MS = 60_000;
export const BREAK_GLASS_WINDOW_BUDGET = 10;

export class InProcessBreakGlassLimiter implements SignInBreakGlassLimiter {
  private windowStartedAt = 0;
  private spent = 0;

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
