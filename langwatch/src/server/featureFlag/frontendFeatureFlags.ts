/**
 * Feature flags exposed to the frontend via session.
 * These are checked in the session callback and added to session.user.enabledFeatures.
 */
export const FRONTEND_FEATURE_FLAGS = ["SCENARIOS"] as const;
export type FrontendFeatureFlag = (typeof FRONTEND_FEATURE_FLAGS)[number];
