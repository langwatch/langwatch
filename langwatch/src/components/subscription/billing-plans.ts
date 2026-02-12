/**
 * Shared billing plan constants
 *
 * Single source of truth for pricing, currency, and feature data
 * used by both SubscriptionPage and PlansComparisonPage.
 */

export type Currency = "EUR" | "USD";

export const SEAT_PRICE: Record<Currency, number> = { EUR: 29, USD: 32 };
export const ANNUAL_DISCOUNT = 0.08;

export const currencySymbol: Record<Currency, string> = { EUR: "€", USD: "$" };

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
  "200,000 events/month (Included)",
  "Unlimited lite users",
  "30 days retention",
  "Unlimited evals",
  "Private Slack support",
];
