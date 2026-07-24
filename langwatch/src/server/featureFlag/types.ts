import type { FeatureFlagKey } from "./registry";

/**
 * Options for evaluating a single feature flag.
 *
 * `distinctId` is the only required field — every flag resolution
 * needs an identity to evaluate against (PostHog user targeting,
 * audit log, cache key salting). The rest are optional knobs.
 */
export interface FeatureFlagEvaluateOptions {
  distinctId: string;
  /**
   * Overrides the registry default for unregistered keys (registered
   * flags always use their `defaultValue` from `registry.ts`).
   */
  defaultValue?: boolean;
  projectId?: string;
  organizationId?: string;
  /**
   * Override the cache TTL (ms) for this evaluation. Used by hot-path
   * callers (kill switches checked per span/event) to avoid stampeding
   * PostHog with one /flags request per cache key per 5 seconds when
   * local evaluation is unavailable. Falls back to the service default
   * when omitted.
   */
  cacheTtlMs?: number;
}

/**
 * Common interface for feature flag services.
 *
 * `flagKey` is `FeatureFlagKey` so every call site is forced to use a
 * registered key — the whole point of moving flags off PostHog onto
 * env + postgres. The legacy PostHog and memory implementations widen
 * the parameter to `string` internally to keep handling arbitrary keys
 * at runtime (back-compat fallback for flags not yet migrated), which
 * is allowed because method parameters are bivariant in class
 * implementations. New callers must register the flag first.
 */
export interface FeatureFlagServiceInterface {
  isEnabled(
    flagKey: FeatureFlagKey,
    opts: FeatureFlagEvaluateOptions,
  ): Promise<boolean>;
}
