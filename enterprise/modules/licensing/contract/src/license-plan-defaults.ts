import { planSeatsAndVolume } from "@langwatch/plans";

import { DEFAULT_MEMBERS_LITE } from "./license-constants.ts";
import type { LicensePlanLimits } from "./license.ts";

const KNOWN_USAGE_UNITS = ["traces", "events"] as const;

/**
 * The plan limits surfaced on the active plan. Only enforced levers (seats,
 * messages volume, webhook endpoints) are resolved; workspace/experiments are
 * OSS/uncapped.
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
 * Resolves enforced plan limits from a license, defaulting maxMembersLite
 * and usageUnit but NOT webhookEndpointsEnabled — absence must stay
 * distinguishable from false, since the tier map decides it for older licenses.
 * @param plan - License plan limits (the signed payload)
 * @returns The enforced limits with the levers the license does set resolved
 */
export function resolvePlanDefaults(plan: LicensePlanLimits): ResolvedPlanLimits {
  return {
    type: plan.type,
    name: plan.name,
    ...planSeatsAndVolume({
      members: plan.maxMembers,
      membersLite: plan.maxMembersLite ?? DEFAULT_MEMBERS_LITE,
      messagesPerMonth: plan.maxMessagesPerMonth,
    }),
    canPublish: plan.canPublish,
    webhookEndpointsEnabled: plan.webhookEndpointsEnabled,
    usageUnit: KNOWN_USAGE_UNITS.includes(plan.usageUnit as (typeof KNOWN_USAGE_UNITS)[number])
      ? (plan.usageUnit ?? "traces")
      : "traces",
  };
}
