/**
 * Options for feature flag evaluation.
 */
export interface FeatureFlagOptions {
  projectId?: string;
  organizationId?: string;
  /**
   * Override the cache TTL (ms) for this evaluation. Used by hot-path
   * callers (kill switches checked per span/event) to avoid stampeding
   * PostHog with one /flags request per cache key per 5 seconds when local
   * evaluation is unavailable. Falls back to the service default when omitted.
   */
  cacheTtlMs?: number;
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
