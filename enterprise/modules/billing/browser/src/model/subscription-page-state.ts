/**
 * What the subscription page decides from the active plan and the planned seat
 * changes: which leg the plan is on, how many seats a change bills, and which
 * change blocks are shown.
 * @see specs/licensing/subscription-page.feature
 */
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";

import { PricingModel } from "./prisma-types.ts";

export type SubscriptionPlanFlags = {
  isDeveloperPlan: boolean;
  isLicenseOverride: boolean;
  isTieredPricingModel: boolean;
  isEnterprisePlan: boolean;
  isTieredLegacyPaidPlan: boolean;
};

export function subscriptionPlanFlags({
  plan,
  pricingModel,
}: {
  plan: PlanInfo | undefined;
  pricingModel: string | null | undefined;
}): SubscriptionPlanFlags {
  const isDeveloperPlan = plan?.free ?? true;
  const isLicenseOverride = plan?.planSource === "license";
  const isTieredPricingModel = pricingModel === PricingModel.TIERED;
  // An enterprise plan is an enterprise plan whichever leg resolved it: tying
  // this to the subscription leg made licensed enterprise customers upgrade candidates.
  const isEnterprisePlan = plan?.type === "ENTERPRISE";
  return {
    isDeveloperPlan,
    isLicenseOverride,
    isTieredPricingModel,
    isEnterprisePlan,
    isTieredLegacyPaidPlan:
      isTieredPricingModel && !isDeveloperPlan && !isEnterprisePlan && !isLicenseOverride,
  };
}

/** Free and license-override plans bill from a one-seat baseline; a paid plan from its capacity. */
export function billingSeatCounts({
  flags,
  totalFullMembers,
  existingCoreMembers,
  maxMembers,
  newPlannedFullMembers,
  deletedSeatCount,
}: {
  flags: SubscriptionPlanFlags;
  totalFullMembers: number;
  existingCoreMembers: number;
  maxMembers: number | undefined;
  newPlannedFullMembers: number;
  deletedSeatCount: number;
}) {
  const fromBaseline = flags.isDeveloperPlan || flags.isLicenseOverride;
  const effectiveMaxSeats = fromBaseline ? 1 : maxMembers;
  const billingSeats = fromBaseline
    ? Math.max(
        totalFullMembers,
        (effectiveMaxSeats ?? 0) + newPlannedFullMembers - deletedSeatCount,
      )
    : Math.max(
        existingCoreMembers,
        (effectiveMaxSeats ?? totalFullMembers) + newPlannedFullMembers - deletedSeatCount,
      );
  // A tiered legacy plan moving to seats bills its members, not the old plan's capacity.
  const upgradeBillingSeats = flags.isTieredLegacyPaidPlan
    ? Math.max(1, totalFullMembers)
    : billingSeats;
  return { effectiveMaxSeats, billingSeats, upgradeBillingSeats };
}

/** Which change blocks the page shows; a free plan needs an upgrade only once seats change. */
export function subscriptionChangesRequired({
  flags,
  hasSeatChanges,
}: {
  flags: SubscriptionPlanFlags;
  hasSeatChanges: boolean;
}) {
  const { isDeveloperPlan, isLicenseOverride, isEnterprisePlan, isTieredLegacyPaidPlan } = flags;
  const isUpgradeSeatsRequired =
    !isDeveloperPlan &&
    !isTieredLegacyPaidPlan &&
    !isEnterprisePlan &&
    !isLicenseOverride &&
    hasSeatChanges;
  const isUpgradePlanRequired =
    ((isDeveloperPlan && hasSeatChanges) || isTieredLegacyPaidPlan || isLicenseOverride) &&
    !isEnterprisePlan;
  const planUpgradeRequired = isDeveloperPlan
    ? hasSeatChanges && !isEnterprisePlan
    : isUpgradePlanRequired;
  return {
    isUpgradeSeatsRequired,
    isUpgradePlanRequired,
    updateRequired: isUpgradeSeatsRequired || planUpgradeRequired,
  };
}
