import type { FeatureFlagKey } from "./registry";
import type { FeatureFlagTargetId } from "./targeting";

/**
 * Options for evaluating a single feature flag.
 *
 * `distinctId` identifies the caller (audit log, cache key salting).
 * `projectId` and `organizationId` are the targeting identity of the
 * read and are both required: a targeting rule that names a scope the
 * read left out can never match, so leaving one out turns a rollout
 * into a silent no-op. A caller with no such scope passes
 * `NOT_TARGETED`.
 */
export interface FeatureFlagEvaluateOptions {
  distinctId: string;
  /**
   * Overrides the registry default for unregistered keys (registered
   * flags always use their `defaultValue` from `registry.ts`).
   */
  defaultValue?: boolean;
  /** The project this read is about, or `NOT_TARGETED`. */
  projectId: FeatureFlagTargetId;
  /** The organization this read is about, or `NOT_TARGETED`. */
  organizationId: FeatureFlagTargetId;
  /**
   * Override the cache TTL (ms) for this evaluation. Used by hot-path
   * callers (kill switches checked per span/event) to control how
   * often the backing store is re-queried. Falls back to the service
   * default when omitted.
   */
  cacheTtlMs?: number;
}

/**
 * Common interface for feature flag services.
 *
 * `flagKey` is `FeatureFlagKey` so every call site is forced to use a
 * registered key — the whole point of moving flags off PostHog onto
 * env + postgres. The legacy memory implementation widens the
 * parameter to `string` internally to keep handling arbitrary keys at
 * runtime (back-compat fallback for flags not yet migrated), which is
 * allowed because method parameters are bivariant in class
 * implementations. New callers must register the flag first.
 */
export interface FeatureFlagServiceInterface {
  isEnabled(
    flagKey: FeatureFlagKey,
    opts: FeatureFlagEvaluateOptions,
  ): Promise<boolean>;
}
