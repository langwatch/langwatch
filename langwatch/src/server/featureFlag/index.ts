export { FeatureFlagService, featureFlagService } from "./featureFlag.service";
export { FeatureFlagServiceMemory } from "./featureFlagService.memory";
export { FeatureFlagServicePostHog } from "./featureFlagService.posthog";
export type { FeatureFlagServiceInterface } from "./types";

/**
 * Feature flags that are exposed to the frontend via session.
 */
export const FRONTEND_FEATURE_FLAGS = ["SCENARIOS"] as const;
