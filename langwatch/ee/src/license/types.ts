/**
 * Self-hosted plan types for LangWatch.
 *
 * Plans determine which features are available based on the LICENSE_KEY.
 */
export type SelfHostedPlan =
  | "self-hosted:oss"
  | "self-hosted:pro"
  | "self-hosted:enterprise";

/**
 * Valid plan values for runtime validation.
 */
export const VALID_PLANS = [
  "self-hosted:oss",
  "self-hosted:pro",
  "self-hosted:enterprise",
] as const;

/**
 * Default plan when no license key is provided.
 */
export const DEFAULT_PLAN: SelfHostedPlan = "self-hosted:oss";

/**
 * Type guard to validate if a value is a valid SelfHostedPlan.
 *
 * @param value - The value to check
 * @returns true if value is a valid SelfHostedPlan
 */
export function isValidPlan(value: unknown): value is SelfHostedPlan {
  return (
    typeof value === "string" &&
    VALID_PLANS.includes(value as SelfHostedPlan)
  );
}
