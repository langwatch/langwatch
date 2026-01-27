import type { FeatureFlagServiceInterface } from "./types";

/**
 * Feature flags exposed to the frontend via session.
 * These are checked in the session callback and added to session.user.enabledFeatures.
 *
 * Naming convention: {area}-{feature}-{subfeature}
 * Examples: ui-simulations-scenarios, es-trace_processing-command-recordSpan-killSwitch
 */
export const FRONTEND_FEATURE_FLAGS = ["ui-simulations-scenarios"] as const;
export type FrontendFeatureFlag = (typeof FRONTEND_FEATURE_FLAGS)[number];

/**
 * Get enabled frontend feature flags for a user.
 * Checks all flags in parallel for performance.
 */
export async function getEnabledFrontendFeatures(
  userId: string,
  flagService: FeatureFlagServiceInterface,
): Promise<FrontendFeatureFlag[]> {
  const results = await Promise.all(
    FRONTEND_FEATURE_FLAGS.map(async (flag) => ({
      flag,
      enabled: await flagService.isEnabled(flag, userId, false),
    })),
  );

  return results.filter((r) => r.enabled).map((r) => r.flag);
}
