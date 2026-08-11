import { DEFAULT_MEMBERS_LITE } from "./constants";
import type { LicensePlanLimits } from "./types";

const KNOWN_USAGE_UNITS = ["traces", "events"] as const;

/**
 * The plan limits that are actually surfaced on the active plan (PlanInfo).
 *
 * Only the enforced levers (member seats, messages volume, webhook endpoints)
 * plus plan identity are resolved. Workspace structure (projects, teams) and
 * experimentation resources are OSS/uncapped, so their license fields — even
 * when present in an older signed payload — are ignored and never resolved
 * here.
 *
 * `webhookEndpointsEnabled` is an enforced lever, not a workspace resource: it
 * gates the webhook endpoints surface and the gateway spend pull APIs, which
 * are sold with Enterprise rather than shipped in the OSS baseline. It is
 * therefore resolved here and deliberately not floored by `floorAtOssBaseline`.
 */
export type ResolvedPlanLimits = {
  type: string;
  name: string;
  maxMembers: number;
  maxMembersLite: number;
  maxMessagesPerMonth: number;
  canPublish: boolean;
  webhookEndpointsEnabled: boolean | undefined;
  usageUnit: string;
};

/**
 * Resolves the enforced plan limits from a license payload, applying defaults
 * to optional fields that may be missing in older licenses:
 * - maxMembersLite: DEFAULT_MEMBERS_LITE (1)
 * - usageUnit: "traces"
 *
 * `webhookEndpointsEnabled` is deliberately NOT defaulted here. A payload that
 * omits it has said nothing, and saying nothing has to stay distinguishable
 * from saying no: the plan's tier decides it later (`planEntitlements.ts`),
 * which is what entitles a license signed before the flag existed. Turning
 * absent into false here would be an answer the contract never gave, and the
 * tier map correctly refuses to overrule an explicit false.
 *
 * @param plan - License plan limits (the signed payload)
 * @returns The enforced limits, with the levers the license does set resolved
 */
export function resolvePlanDefaults(
  plan: LicensePlanLimits,
): ResolvedPlanLimits {
  return {
    type: plan.type,
    name: plan.name,
    maxMembers: plan.maxMembers,
    maxMessagesPerMonth: plan.maxMessagesPerMonth,
    canPublish: plan.canPublish,
    maxMembersLite: plan.maxMembersLite ?? DEFAULT_MEMBERS_LITE,
    webhookEndpointsEnabled: plan.webhookEndpointsEnabled,
    usageUnit: KNOWN_USAGE_UNITS.includes(plan.usageUnit as any)
      ? plan.usageUnit!
      : "traces",
  };
}
