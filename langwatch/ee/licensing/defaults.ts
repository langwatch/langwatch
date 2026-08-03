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
  webhookEndpointsEnabled: boolean;
  usageUnit: string;
};

/**
 * Resolves the enforced plan limits from a license payload, applying defaults
 * to optional fields that may be missing in older licenses:
 * - maxMembersLite: DEFAULT_MEMBERS_LITE (1)
 * - webhookEndpointsEnabled: false (licenses signed before the flag existed)
 * - usageUnit: "traces"
 *
 * @param plan - License plan limits (the signed payload)
 * @returns The enforced limits with all fields guaranteed to have values
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
    webhookEndpointsEnabled: plan.webhookEndpointsEnabled ?? false,
    usageUnit: KNOWN_USAGE_UNITS.includes(plan.usageUnit as any)
      ? plan.usageUnit!
      : "traces",
  };
}
