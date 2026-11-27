import type { PlanProvider } from "@langwatch/entitlement-contract";
import { nowInstant } from "@langwatch/time";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The plan's read gates: the ADR-028 teaser cutoff and the over-plan withholding cutoff. */
export type VisibilityWindow = {
  visibilityCutoffMs: number | null;
  withheldFromMs: number | null;
  overPlan: { members: number; maxMembers: number } | null;
};

/**
 * @see dev/docs/adr/028-visibility-blur-teaser-redaction.md
 * Resolves the plan-based visibility cutoff for an organization. Stateless: every call evaluates
 * the current plan. Plan-resolution failures propagate; the caller owns the fail-closed fallback.
 */
export class VisibilityWindowService {
  static create(planProvider: PlanProvider): VisibilityWindowService {
    return new VisibilityWindowService(planProvider);
  }

  private constructor(private readonly planProvider: PlanProvider) {}

  /**
   * Answers the epoch-ms cutoff before which content must be teased; the cutoff is
   * `null` when the plan has no visibility window (all paid/licensed plans).
   * Throws when plan resolution fails — callers must fail closed.
   */
  async getVisibilityWindow({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<VisibilityWindow> {
    const plan = await this.planProvider.getActivePlan({ organizationId });
    const overPlan = plan?.overPlan ?? null;
    const withholding = {
      withheldFromMs: overPlan?.sinceMs ?? null,
      overPlan: overPlan ? { members: overPlan.members, maxMembers: overPlan.maxMembers } : null,
    };
    const visibilityDays = plan?.visibilityDays;
    if (visibilityDays === null || visibilityDays === undefined) {
      return { visibilityCutoffMs: null, ...withholding };
    }

    return {
      visibilityCutoffMs: nowInstant().epochMilliseconds - visibilityDays * DAY_MS,
      ...withholding,
    };
  }

  /** True when a trace/span started before the cutoff (content must be teased). */
  isBeyondWindow({
    startedAtMs,
    cutoffMs,
  }: {
    startedAtMs: number;
    cutoffMs: number | null;
  }): boolean {
    return cutoffMs !== null && startedAtMs < cutoffMs;
  }
}
