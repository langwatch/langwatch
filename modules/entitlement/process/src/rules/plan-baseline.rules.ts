import type { Plan } from "@langwatch/entitlement-contract";
import {
  BASELINES,
  findRequestBound,
  quotedLimitsOfPlan,
  type Plan as CataloguePlan,
  type RequestBoundKey,
} from "@langwatch/plans";

/**
 * The deployment's own starting plan, before any paid source is consulted.
 * Adapted from `@langwatch/plans`'s catalogue, not the Enterprise contract's
 * `PLAN_LIMITS.FREE` — disputed to match (catalogue-data.ts's `disputed` field).
 */
export function coreBaselinePlan({ isSaas }: { isSaas: boolean }): Plan {
  const plan: CataloguePlan = isSaas ? BASELINES.cloud : BASELINES["self-hosted"];

  return {
    planSource: "free",
    type: plan.type,
    name: plan.name,
    free: plan.free,
    ...quotedLimitsOfPlan(plan),
  };
}

/**
 * A bound where no entitlement graph is composed at all: its free-tier value, the same
 * fail-open answer an unknown plan type gets from `resolveRequestBound`.
 */
export function absentRequestBound({ key }: { key: RequestBoundKey }): number {
  const bound = findRequestBound(key);
  if (bound === undefined) {
    throw new Error(`Unknown request bound: ${key}.`);
  }
  return bound.free;
}
