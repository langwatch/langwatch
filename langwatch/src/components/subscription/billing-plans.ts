/**
 * Shared billing plan constants
 *
 * Pricing is derived from the Stripe catalog (single source of truth).
 * Feature lists and currency helpers used by SubscriptionPage and PlansComparisonPage.
 */

import { Currency } from "@prisma/client";
import { formatNumber } from "~/utils/formatNumber";

export type { Currency } from "../../../ee/billing/pricing";
export {
  getGrowthSeatPriceCents,
  getAnnualDiscountPercent,
  formatPrice,
} from "../../../ee/billing/pricing";
export { parseGrowthSeatPlanType } from "../../../ee/billing/utils/growthSeatEvent";
export type { BillingInterval } from "../../../ee/billing/utils/growthSeatEvent";

export const currencySymbol: Record<Currency, string> = {
  [Currency.EUR]: "\u20AC",
  [Currency.USD]: "$",
};

/**
 * Growth plan features for upgrade block
 */
export const GROWTH_FEATURES = [
  "Up to 20 core users",
  "200,000 events included",
  "$1 per additional 100,000 events",
  "Unlimited lite users",
  "30 days retention",
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
  "3 scenarios",
  "3 simulations",
  "3 custom evaluations",
  "Community support",
];

export const GROWTH_PLAN_FEATURES = [
  "Everything in Free",
  "200,000 events included",
  "$1 per additional 100,000 events",
  "30 days retention (+ custom at $3/GB)",
  "Up to 20 core users (volume discount available)",
  "Unlimited lite users",
  "Unlimited evals, simulations and prompts",
  "Slack support",
];

export const ENTERPRISE_PLAN_FEATURES = [
  "Alternative hosting options",
  "Custom data retention",
  "Custom SSO / RBAC",
  "Audit logs",
  "Uptime & Support SLA",
  "Compliance and legal reviews",
  "Custom terms and DPA",
  "Dedicated Solution Engineer",
  "Slack / Teams support",
  "AWS/Azure/GCP Marketplace",
  "ISO27001 / SOC2 reports",
];

export function buildTieredCapabilities({
  maxMembers,
  maxMessagesPerMonth,
  maxProjects,
  maxMembersLite,
  evaluationsCredit,
}: {
  maxMembers: number;
  maxMessagesPerMonth: number;
  maxProjects: number;
  maxMembersLite: number;
  evaluationsCredit: number;
}) {
  const coreUsersText =
    maxMembers > 0
      ? `Up to ${formatNumber(maxMembers)} core users`
      : "Custom core user limits";
  const eventsText =
    maxMessagesPerMonth > 0
      ? `${formatNumber(maxMessagesPerMonth)} events included`
      : "Custom event limits";
  const projectsText =
    maxProjects >= 9999
      ? "Unlimited projects"
      : maxProjects > 0
        ? `Up to ${formatNumber(maxProjects)} projects`
        : "Custom project limits";
  const liteUsersText =
    maxMembersLite >= 9999
      ? "Unlimited lite users"
      : maxMembersLite > 0
        ? `Up to ${formatNumber(maxMembersLite)} lite users`
        : "Custom lite user limits";
  const evalsText =
    evaluationsCredit >= 9999
      ? "Unlimited evaluations"
      : evaluationsCredit > 0
        ? `${formatNumber(evaluationsCredit)} evaluation credits`
        : "Custom evaluation limits";

  return [
    coreUsersText,
    eventsText,
    projectsText,
    liteUsersText,
    evalsText,
  ];
}
