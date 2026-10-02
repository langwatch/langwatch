import { PricingModel, type Plan, type UsageUnit } from "@langwatch/entitlement-contract";
import type { MonthCountedEventData, UsageLimit } from "@langwatch/usage-contract";

/** Entitlement's sentinel for a plan that caps nothing. */
const UNLIMITED_ALLOWANCE = 999_999_999;

/** The unit a plan is counted in; entitlement's `resolveUsageMeter` until counting leaves it. */
export function usageUnitOf({
  plan,
  pricingModel,
}: {
  plan: Plan;
  pricingModel: string | null;
}): UsageUnit {
  if (plan.planSource === "license" && plan.usageUnit) {
    const unit = plan.usageUnit.toLowerCase().trim();
    return unit === "events" || unit === "event" ? "events" : "traces";
  }
  return pricingModel === PricingModel.SEAT_EVENT || plan.free ? "events" : "traces";
}

/** The limit a month is held against, as the plan states it. */
export function usageLimitOf({ plan, unit }: { plan: Plan; unit: UsageUnit }): UsageLimit {
  return { allowance: plan.maxMessagesPerMonth, planName: plan.name, unit };
}

/** What the decider remembers per organization: the month it holds and whether it refuses. */
export type LimitState = Readonly<{ month: string | null; reached: boolean }>;

export type LimitDecision = "reached" | "cleared" | "none";

/** Decides a counted month against the remembered state; last month's count changes nothing. */
export function decideLimit({
  state,
  counted,
}: {
  state: LimitState;
  counted: MonthCountedEventData;
}): { state: LimitState; decision: LimitDecision } {
  if (state.month !== null && counted.month < state.month) return { state, decision: "none" };
  const reached = state.month === counted.month && state.reached;
  const { allowance, unit } = counted.limit;
  // ponytail: only the events meter lives here yet; a traces plan decides
  // nothing until the trace meter moves.
  const over =
    unit === "events" && allowance < UNLIMITED_ALLOWANCE && counted.billableEvents >= allowance;
  if (over === reached) return { state: { month: counted.month, reached: over }, decision: "none" };
  const decision: LimitDecision = over ? "reached" : "cleared";
  return { state: { month: counted.month, reached: over }, decision };
}
