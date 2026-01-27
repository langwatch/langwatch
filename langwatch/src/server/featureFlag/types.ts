/**
 * Common interface for feature flag services.
 */
export interface FeatureFlagServiceInterface {
  /**
   * Check if a feature flag is enabled for a given user or tenant/project.
   */
  isEnabled(
    flagKey: string,
    distinctId: string,
    defaultValue?: boolean,
  ): Promise<boolean>;

  /**
   * Get all enabled flags from a list of flag keys for a given user or tenant/project.
   * Returns an array of flag keys that are enabled.
   */
  getEnabledFlags(flagKeys: string[], distinctId: string): Promise<string[]>;
}
