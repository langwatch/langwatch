// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { DEFAULT_LIMIT } from "./license-constants";
import type { LicensePlanLimits } from "./license";

export interface BuildMintedPlanParams {
  type: string;
  name: string;
  maxMembers: number;
  maxMembersLite?: number;
  maxMessagesPerMonth: number;
  canPublish: boolean;
  webhookEndpointsEnabled?: boolean;
  usageUnit?: string;
}

/**
 * Assembles the plan payload that gets signed into a license.
 *
 * Two constraints shape this, and neither survives being rediscovered:
 *
 * 1. **Key order is part of the signature.** `verifySignature` re-serializes
 *    the Zod-parsed payload, and `z.object` emits keys in schema declaration
 *    order, so the order here must match `LicensePlanLimitsSchema` or the
 *    license it signs cannot verify.
 *
 * 2. **`maxProjects` and `maxWorkflows` are still minted** even though nothing
 *    reads them any more. They only became optional in the release that
 *    uncapped them; every deployment older than that requires them and rejects
 *    a license that omits them, dropping to the one-seat free plan. Since we
 *    issue licenses from a continuously deployed control plane to customers who
 *    upgrade on their own schedule, omitting them would mean a renewal locking
 *    a paying customer out of their own deployment. They are minted at
 *    `DEFAULT_LIMIT`, so an older deployment reads them as uncapped, which is
 *    what the fields now mean everywhere.
 *
 * A field may only be dropped from here once no supported version requires it.
 *
 * `webhookEndpointsEnabled` is minted because it is an entitlement the license
 * sells, not a resource cap the OSS baseline uncapped. It is the only thing
 * that switches on webhook endpoints and the gateway spend pull APIs on a
 * self-hosted deployment, so a license that omits it leaves a paying customer
 * with the surfaces answering 403.
 */
export function buildMintedPlan({
  type,
  name,
  maxMembers,
  maxMembersLite,
  maxMessagesPerMonth,
  canPublish,
  webhookEndpointsEnabled,
  usageUnit,
}: BuildMintedPlanParams): LicensePlanLimits {
  return {
    type,
    name,
    maxMembers,
    maxMembersLite,
    maxProjects: DEFAULT_LIMIT,
    maxMessagesPerMonth,
    maxWorkflows: DEFAULT_LIMIT,
    canPublish,
    webhookEndpointsEnabled,
    usageUnit,
  };
}
