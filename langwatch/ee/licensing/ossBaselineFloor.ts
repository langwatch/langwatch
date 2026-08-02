// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { UNLIMITED_PLAN } from "./constants";
import type { PlanInfo } from "./planInfo";

/**
 * Raises a license-resolved plan so it is never more restrictive than the
 * open-source baseline a self-hosted deployment runs on without a license.
 *
 * A license sells the Enterprise surface and a support relationship, not
 * permission to run the software, so activating one may only add. Templates
 * still mint finite seat and volume numbers into the signed payload, and a
 * signature cannot be edited after issuance, so the correction belongs here at
 * resolution time. Applying it here also repairs licenses that were already
 * issued, without re-issuing them.
 *
 * Identity is left alone: type, name, `free`, and plan source keep coming from
 * the license, because the deployment really is on Enterprise. Only the limits
 * move, and only upward.
 *
 * `overrideAddingLimitations` is deliberately not floored. It is authorization
 * rather than entitlement (the composite provider recomputes it from the
 * impersonation context), and with the numeric limits already at the baseline
 * the creation guards cannot trip anyway.
 *
 * This is a self-hosted policy. On Cloud a license is the negotiated contract
 * and is meant to override the subscription in both directions.
 */
export function floorAtOssBaseline(plan: PlanInfo): PlanInfo {
  return {
    ...plan,
    maxMembers: Math.max(plan.maxMembers, UNLIMITED_PLAN.maxMembers),
    maxMembersLite: Math.max(
      plan.maxMembersLite,
      UNLIMITED_PLAN.maxMembersLite,
    ),
    maxMessagesPerMonth: Math.max(
      plan.maxMessagesPerMonth,
      UNLIMITED_PLAN.maxMessagesPerMonth,
    ),
    canPublish: plan.canPublish || UNLIMITED_PLAN.canPublish,
  };
}
