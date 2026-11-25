/** Billing plan constants; pricing from Stripe catalog. */

import { getGrowthRetentionLabel } from "@langwatch/data-retention-contract";
import {
  Currency,
  formatPrice,
  isAnnualTieredPlan,
  parseGrowthSeatPlanType,
  resolveGrowthSeatPlanType,
  UNLIMITED_MESSAGES,
  type BillingInterval,
  type Currency as CurrencyType,
} from "@langwatch/enterprise-billing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import numeral from "numeral";

const formatNumber = (value: number): string => numeral(value).format("0,0");

export { formatPrice, isAnnualTieredPlan, parseGrowthSeatPlanType, resolveGrowthSeatPlanType };
export type { BillingInterval, CurrencyType as Currency };

export const currencySymbol: Record<Currency, string> = {
  [Currency.EUR]: "\u20AC",
  [Currency.USD]: "$",
};

/** Beside a Cloud price: the provider adds VAT on top where the buyer owes it. */
export const EXCLUDING_VAT = "excl. VAT";

/** The events a Growth plan includes each month before overage. */
export const GROWTH_INCLUDED_EVENTS = 200_000;

/** What each further 100,000 events costs on Growth, in cents of the currency. */
export const growthOverageCentsPer100k = (currency: Currency): number =>
  currency === Currency.EUR ? 500 : 600;

/** Returns the per-100K events pricing string for the given currency. */
const growthEventsPricingString = (currency: Currency): string =>
  `${formatPrice({ cents: growthOverageCentsPer100k(currency), currency })} per additional 100,000 events`;

/** What one GB a month of storage beyond the retention Growth includes costs, in cents. */
export const retentionStorageCentsPerGb = (currency: Currency): number =>
  currency === Currency.EUR ? 300 : 400;

const growthRetentionPricingString = (currency: Currency): string =>
  currency === Currency.EUR
    ? "90 days retention (+ custom at \u20AC3/GB)"
    : "90 days retention (+ custom at $4/GB)";

/** The retention line: what the organization keeps when known, else the 90 days Growth includes. */
export const growthRetentionFeature = (retentionDays?: number): string => {
  if (retentionDays === undefined) return "90 days retention";
  if (retentionDays === 0) return "Unlimited retention";
  return `${getGrowthRetentionLabel(retentionDays)} retention`;
};

/**
 * Growth plan features for upgrade block.
 * Accepts a currency so the events pricing line is accurate.
 */
export const getGrowthFeatures = (currency: Currency, retentionDays?: number): string[] => [
  "Volume discounts above 20 users",
  `${formatNumber(GROWTH_INCLUDED_EVENTS)} events included`,
  growthEventsPricingString(currency),
  "Unlimited lite users",
  growthRetentionFeature(retentionDays),
  "Unlimited evals",
  "Private Slack support",
];

/**
 * Plan comparison page feature lists (detailed)
 */
export const FREE_PLAN_FEATURES = [
  "All platform features",
  "50,000 events included",
  "14 days data retention",
  "2 users",
  "3 scenarios, 3 simulations, 3 custom evals",
  "Community support",
];

/**
 * Plan comparison page feature list for Growth.
 * Accepts a currency so the events and retention pricing lines are accurate.
 */
export const getGrowthPlanFeatures = (currency: Currency): string[] => [
  "Everything in Free",
  "200,000 events included",
  growthEventsPricingString(currency),
  growthRetentionPricingString(currency),
  "Volume discounts above 20 users",
  "Unlimited lite users",
  "Unlimited evals, simulations and prompts",
  "Slack support",
];

export const WEBHOOK_FEATURE_LABEL = "Gateway webhooks for metering and rebilling";

/**
 * What the Enterprise tier offers, each bullet tied to the entitlement
 * that decides it. The tie is the field name, not the sentence — reworded
 * copy still describes the same capability, with nothing matching prose.
 */
const ENTERPRISE_PLAN_FEATURE_ENTRIES: readonly {
  label: string;
  /** The plan field that decides this bullet, when one does. */
  entitlement?: keyof Pick<PlanInfo, "webhookEndpointsEnabled">;
}[] = [
  { label: "Alternative hosting options" },
  { label: "Custom data retention" },
  { label: "Custom SSO / RBAC" },
  { label: "Audit logs" },
  { label: WEBHOOK_FEATURE_LABEL, entitlement: "webhookEndpointsEnabled" },
  { label: "Uptime & Support SLA" },
  { label: "Compliance and legal reviews" },
  { label: "Custom terms and DPA" },
  { label: "Dedicated Solution Engineer" },
  { label: "Slack / Teams support" },
  { label: "AWS/Azure/GCP Marketplace" },
  { label: "ISO27001 / SOC2 reports" },
];

/**
 * The Enterprise tier as it is SOLD: everything the tier offers, whatever any
 * one contract settled on. This is the list for the pages that are selling it.
 */
export const ENTERPRISE_PLAN_FEATURES = ENTERPRISE_PLAN_FEATURE_ENTRIES.map((entry) => entry.label);

/**
 * Enterprise tier as a customer holds it: the full list minus explicit withholds.
 * Only false removes a feature; missing fields default to granted, not withheld.
 */
export function buildEnterprisePlanFeatures(
  plan: Pick<PlanInfo, "webhookEndpointsEnabled">,
): string[] {
  return ENTERPRISE_PLAN_FEATURE_ENTRIES.filter(
    (entry) => !entry.entitlement || plan[entry.entitlement] !== false,
  ).map((entry) => entry.label);
}

function eventsCapabilityText(maxMessagesPerMonth: number): string {
  if (maxMessagesPerMonth >= UNLIMITED_MESSAGES) return "Unlimited events";
  if (maxMessagesPerMonth > 0) return `${formatNumber(maxMessagesPerMonth)} events included`;
  return "Custom event limits";
}

function liteUsersCapabilityText(maxMembersLite: number): string {
  if (maxMembersLite >= 9999) return "Unlimited lite users";
  if (maxMembersLite > 0) return `Up to ${formatNumber(maxMembersLite)} lite users`;
  return "Custom lite user limits";
}

export function buildPlanCapabilities({
  maxMembers,
  maxMessagesPerMonth,
  maxMembersLite,
}: {
  maxMembers: number;
  maxMessagesPerMonth: number;
  maxMembersLite: number;
}) {
  const coreUsersText =
    maxMembers > 0 ? `Up to ${formatNumber(maxMembers)} core users` : "Custom core user limits";
  const eventsText = eventsCapabilityText(maxMessagesPerMonth);
  const liteUsersText = liteUsersCapabilityText(maxMembersLite);
  return [coreUsersText, eventsText, liteUsersText];
}
