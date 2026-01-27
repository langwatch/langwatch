export { FeatureFlagService, featureFlagService } from "./featureFlag.service";
export { FeatureFlagServiceMemory } from "./featureFlagService.memory";
export { FeatureFlagServicePostHog } from "./featureFlagService.posthog";
export type { FeatureFlagServiceInterface } from "./types";

export const FRONTEND_FEATURE_FLAGS = ["SCENARIOS"] as const;
export type FrontendFeatureFlag = (typeof FRONTEND_FEATURE_FLAGS)[number];
