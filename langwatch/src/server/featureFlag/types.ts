/**
 * Options for feature flag evaluation.
 */
export interface FeatureFlagOptions {
  projectId?: string;
  organizationId?: string;
}

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
    options?: FeatureFlagOptions,
  ): Promise<boolean>;
}
