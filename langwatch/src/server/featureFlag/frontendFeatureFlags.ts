/**
 * Feature flags exposed to the frontend via session.
 * These are checked in the session callback and added to session.user.enabledFeatures.
 *
 * Naming convention: {area}-{feature}-{subfeature}
 * Examples: ui-simulations-scenarios, es-trace_processing-command-recordSpan-killSwitch
 */
export const FRONTEND_FEATURE_FLAGS = ["ui-simulations-scenarios"] as const;
export type FrontendFeatureFlag = (typeof FRONTEND_FEATURE_FLAGS)[number];
