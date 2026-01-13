/**
 * Common interface for feature flag services.
 */
export interface FeatureFlagServiceInterface {
  /**
   * Check if a feature flag is enabled for a given user or tenant/project.
   */
  isEnabled(flagKey: string, distinctId: string, defaultValue?: boolean): Promise<boolean>;
}
