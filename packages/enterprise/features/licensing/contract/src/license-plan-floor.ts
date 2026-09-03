// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { UNLIMITED_PLAN } from "./license-constants";
import type { PlanInfo } from "./license-plan";

/**
 * Raises a license-resolved plan so it is never more restrictive than the
 * open-source baseline, on everything except the seats the license sells.
 *
 * Seats are the deliberate exception. A self-hosted Enterprise license is
 * priced per seat, so the seat count in the signed payload is the thing the
 * customer bought and it has to bind: a ten-seat license must refuse the
 * eleventh member. Flooring seats would make every seat clause in every
 * self-hosted contract unenforceable by the product, since the unlicensed
 * baseline is uncapped and any finite number is therefore "worse" than it.
 *
 * Everything else is floored, because nothing else is sold by quantity on
 * self-hosted. Message volume is explicitly not metered there (the data is in
 * the customer's own database and we never see it), and publishing is part of
 * the open-source floor, so a license may not withdraw either.
 *
 * That leaves the guarantee narrower but still true where it matters: no
 * capability a deployment had before it paid disappears when it does. Seats are
 * not a capability, they are the meter.
 *
 * Identity is left alone: type, name, `free`, and plan source keep coming from
 * the license, because the deployment really is on Enterprise.
 *
 * `overrideAddingLimitations` is deliberately not floored. It is authorization
 * rather than entitlement (the composite provider recomputes it from the
 * impersonation context), and flooring it would switch off the seat guard this
 * function now goes out of its way to preserve.
 *
 * This is a self-hosted policy. On Cloud a license is the negotiated contract
 * and is meant to override the subscription in both directions.
 */
export function floorAtOssBaseline(plan: PlanInfo): PlanInfo {
  return {
    ...plan,
    maxMessagesPerMonth: Math.max(plan.maxMessagesPerMonth, UNLIMITED_PLAN.maxMessagesPerMonth),
    canPublish: plan.canPublish || UNLIMITED_PLAN.canPublish,
  };
}
