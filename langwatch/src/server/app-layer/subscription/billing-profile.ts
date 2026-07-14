import { isGrowthSeatEventPlan } from "../../../../ee/billing/utils/growthSeatEvent";
import type {
  BillingProfile,
  MemberPolicy,
  PlanCapabilities,
} from "../../../../ee/licensing/planInfo";

type WinningPlan = {
  type: string;
  free: boolean;
  planSource: "license" | "subscription" | "free";
};

const isEnterprise = (plan: WinningPlan) => plan.type === "ENTERPRISE";

/**
 * Derives billing mechanics from the winning plan source (ADR-039 Decision 4):
 * - seat-event subscription → purchase_seat (self-serve proration flow)
 * - ENTERPRISE license → hard_cap (sales-owned deals)
 * - non-ENTERPRISE license on SaaS → upgrade (a purchased subscription
 *   outranks the license, preserving the self-serve escape)
 * - any license on self-hosted → hard_cap (no Stripe)
 * - everything else paid (legacy tiered) and free → upgrade on SaaS,
 *   hard_cap on self-hosted
 */
export function deriveBillingProfile({
  plan,
  isSaaS,
}: {
  plan: WinningPlan;
  isSaaS: boolean;
}): BillingProfile {
  const isSeatEvent =
    plan.planSource === "subscription" && isGrowthSeatEventPlan(plan.type);
  const isLegacyTiered =
    plan.planSource === "subscription" && !isSeatEvent && !plan.free;

  return {
    meterUnit: isSeatEvent ? "events" : "traces",
    memberPolicy: deriveMemberPolicy({ plan, isSaaS, isSeatEvent }),
    // Seat-event orgs are usage-billed: limits are not a wall, so hide them.
    showUsageLimits: !isSeatEvent,
    isLegacyTiered,
  };
}

function deriveMemberPolicy({
  plan,
  isSaaS,
  isSeatEvent,
}: {
  plan: WinningPlan;
  isSaaS: boolean;
  isSeatEvent: boolean;
}): MemberPolicy {
  if (isSeatEvent) {
    return "purchase_seat";
  }
  if (!isSaaS) {
    // No Stripe on self-hosted: expansion always requires a new license.
    return "hard_cap";
  }
  if (plan.planSource === "license" && isEnterprise(plan)) {
    return "hard_cap";
  }
  return "upgrade";
}

/**
 * Enterprise-gated capabilities (ADR-039 Decision 6). The key set mirrors the
 * former `assertEnterprisePlan` call sites; all keys currently share the same
 * ENTERPRISE gate, kept as independent flags so future plans can unbundle.
 */
export function deriveCapabilities({
  plan,
}: {
  plan: WinningPlan;
}): PlanCapabilities {
  const enterprise = isEnterprise(plan);
  return {
    rbac: enterprise,
    scim: enterprise,
    sso: enterprise,
    groups: enterprise,
    customRoles: enterprise,
  };
}
