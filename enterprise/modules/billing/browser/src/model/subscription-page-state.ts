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
  seatUsage,
}: {
  flags: SubscriptionPlanFlags;
  totalFullMembers: number;
  existingCoreMembers: number;
  maxMembers: number | undefined;
  newPlannedFullMembers: number;
  deletedSeatCount: number;
  /** Seats in use as the page shows them: the server's count once it answered. */
  seatUsage: number;
}) {
  const fromBaseline = flags.isDeveloperPlan || flags.isLicenseOverride;
  const effectiveMaxSeats = fromBaseline ? 1 : maxMembers;
  const billingSeats = fromBaseline
    ? Math.max(
        totalFullMembers,
        seatUsage,
        (effectiveMaxSeats ?? 0) + newPlannedFullMembers - deletedSeatCount,
      )
    : Math.max(
        existingCoreMembers,
        (effectiveMaxSeats ?? totalFullMembers) + newPlannedFullMembers - deletedSeatCount,
      );
  // A tiered legacy plan moving to seats bills its members, not the old plan's capacity.
  const upgradeBillingSeats = flags.isTieredLegacyPaidPlan
    ? Math.max(1, totalFullMembers, seatUsage)
    : billingSeats;
  return { effectiveMaxSeats, billingSeats, upgradeBillingSeats };
}

/**
 * Seats in use as enforcement counts them (custom roles, open invites) once the
 * server answered, plus rows planned in the drawer; the page's own count until then.
 */
export function seatUsageCount({
  serverMembersCount,
  plannedFullMembers,
  pageCount,
}: {
  serverMembersCount: number | undefined;
  plannedFullMembers: number;
  pageCount: number;
}): number {
  return serverMembersCount === undefined ? pageCount : serverMembersCount + plannedFullMembers;
}

/** Which change blocks the page shows; a free plan upgrades once seats change or overflow. */
export function subscriptionChangesRequired({
  flags,
  hasSeatChanges,
  isOverPlanSeats,
}: {
  flags: SubscriptionPlanFlags;
  hasSeatChanges: boolean;
  /** Above the plan's seats, the upgrade (or more seats) is offered up front. */
  isOverPlanSeats: boolean;
}) {
  const { isDeveloperPlan, isLicenseOverride, isEnterprisePlan, isTieredLegacyPaidPlan } = flags;
  const isUpgradeSeatsRequired =
    !isDeveloperPlan &&
    !isTieredLegacyPaidPlan &&
    !isEnterprisePlan &&
    !isLicenseOverride &&
    hasSeatChanges;
  // A free plan over its seats is offered the upgrade up front, not after an invite is refused.
  const isUpgradePlanRequired =
    ((isDeveloperPlan && (hasSeatChanges || isOverPlanSeats)) ||
      isTieredLegacyPaidPlan ||
      isLicenseOverride) &&
    !isEnterprisePlan;
  const planUpgradeRequired = isDeveloperPlan
    ? hasSeatChanges && !isEnterprisePlan
    : isUpgradePlanRequired;
  return {
    isUpgradeSeatsRequired,
    isUpgradePlanRequired,
    updateRequired:
      isUpgradeSeatsRequired || planUpgradeRequired || (isOverPlanSeats && !isEnterprisePlan),
  };
}
