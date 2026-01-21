/**
 * Self-hosted plan types for LangWatch.
 *
 * Plans determine which features are available based on the LICENSE_KEY.
 */
export type SelfHostedPlan =
  | "self-hosted:oss"
  | "self-hosted:pro"
  | "self-hosted:enterprise";
