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

/** Which change blocks the page shows; a free plan is always offered the upgrade. */
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
  const isUpgradePlanRequired =
    (isDeveloperPlan || isTieredLegacyPaidPlan || isLicenseOverride) && !isEnterprisePlan;
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

/** This month's events on the plan card: the count, and the cap with a meter where one applies. */
export type PlanEventUsage = {
  label: string;
  /** What the plan counts, in the plural: "events" or "traces". */
  noun: "events" | "traces";
  value: string;
  /** Share of the cap used, or null when the plan has no cap to measure against. */
  fillRatio: number | null;
  status: "ok" | "warning" | "exceeded";
};

export function planEventUsage({
  currentMonthCount,
  messageLimitInfo,
  usageUnit,
  showLimit,
}: {
  /** Null when the counting store could not answer: no figure is shown rather than a false zero. */
  currentMonthCount: number | null | undefined;
  messageLimitInfo:
    | {
        status: PlanEventUsage["status"];
        current: number;
        max: number;
        currentFormatted: string;
        maxFormatted: string;
      }
    | undefined;
  usageUnit: string | undefined;
  /** Whether the plan's cap is a limit the reader works against (see shouldShowPlanLimits). */
  showLimit: boolean;
}): PlanEventUsage | undefined {
  if (!messageLimitInfo || currentMonthCount == null) return undefined;
  const noun = usageUnit === "traces" ? "traces" : "events";
  const label = noun === "traces" ? "Traces this month" : "Events this month";
  const capped =
    showLimit && messageLimitInfo.max > 0 && messageLimitInfo.maxFormatted !== "Unlimited";
  if (!capped) {
    return { label, noun, value: messageLimitInfo.currentFormatted, fillRatio: null, status: "ok" };
  }
  return {
    label,
    noun,
    value: `${messageLimitInfo.currentFormatted} / ${messageLimitInfo.maxFormatted}`,
    fillRatio: messageLimitInfo.current / messageLimitInfo.max,
    status: messageLimitInfo.status,
  };
}

/** The plan card's price row: the period total, then seats times the seat price. */
export type PlanPrice = {
  total: string;
  /** Seats times the seat price (from two seats), then the per-month seat price on annual plans. */
  breakdown?: string;
};

export function planPrice({
  seatCount,
  seatPrice,
  total,
  monthlyEquivalent,
}: {
  seatCount: number;
  seatPrice: string;
  total: string;
  /** Annual plans add the per-month seat price, as the rest of the page does. */
  monthlyEquivalent?: string;
}): PlanPrice {
  const parts = [
    seatCount > 1 ? `${seatCount} seats \u00d7 ${seatPrice}` : undefined,
    monthlyEquivalent,
  ].filter((part): part is string => Boolean(part));
  return { total, breakdown: parts.length > 0 ? parts.join(" · ") : undefined };
}
