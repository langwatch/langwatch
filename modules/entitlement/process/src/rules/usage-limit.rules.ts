import {
  type MonthCountedEventData,
  PricingModel,
  type Plan,
  type UsageLimit,
  type UsageUnit,
} from "@langwatch/entitlement-contract";

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

/** Whether the limit caps anything; an uncapped plan is never counted for enforcement. */
export function isCapped(limit: UsageLimit): boolean {
  return limit.allowance < UNLIMITED_ALLOWANCE;
}

/** The month's count in the limit's own unit, or that its meter was not read. */
export type UnitCount = Readonly<{ read: true; count: number }> | Readonly<{ read: false }>;

export function countInUnit(counted: MonthCountedEventData): UnitCount {
  const count = counted.limit.unit === "traces" ? counted.traces : counted.billableEvents;
  return count === undefined ? { read: false } : { read: true, count };
}

/** The limit a month is held against, as the plan states it. */
export function usageLimitOf({ plan, unit }: { plan: Plan; unit: UsageUnit }): UsageLimit {
  return { allowance: plan.maxMessagesPerMonth, planName: plan.name, unit };
}

/** What the decider remembers per organization: the month it holds and whether it refuses. */
export type LimitState = Readonly<{ month: string | null; reached: boolean }>;

type LimitDecision = "reached" | "cleared" | "none";

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
  const inUnit = countInUnit(counted);
  const capped = isCapped(counted.limit);
  // A capped month whose meter was not read (an event recorded before traces were counted).
  if (capped && !inUnit.read) return { state, decision: "none" };
  const over = capped && inUnit.read && inUnit.count >= counted.limit.allowance;
  if (over === reached) return { state: { month: counted.month, reached: over }, decision: "none" };
  const decision: LimitDecision = over ? "reached" : "cleared";
  return { state: { month: counted.month, reached: over }, decision };
}
