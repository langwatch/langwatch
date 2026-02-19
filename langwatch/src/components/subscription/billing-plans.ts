/**
 * Shared billing plan constants
 *
 * Pricing is derived from the Stripe catalog (single source of truth).
 * Feature lists and currency helpers used by SubscriptionPage and PlansComparisonPage.
 */

export type { Currency } from "../../../ee/billing/pricing";
export {
  getGrowthSeatPriceCents,
  getAnnualDiscountPercent,
  formatPrice,
} from "../../../ee/billing/pricing";

export const currencySymbol: Record<"EUR" | "USD", string> = {
  EUR: "\u20AC",
  USD: "$",
};

/**
 * Developer plan features for current plan block
 */
export const DEVELOPER_FEATURES = [
  "Up to 2 core members",
  "Limited platform features",
  "Community support",
];

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
  "3 scenarios, 3 simulations, 3 custom evaluations",
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
