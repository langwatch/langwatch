import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import { getPostHogInstance } from "../posthog";
import { FEATURE_FLAG_CACHE_TTL_MS } from "./constants";
import { StaleWhileRevalidateCache } from "./staleWhileRevalidateCache.redis";
import type { FeatureFlagOptions, FeatureFlagServiceInterface } from "./types";

/**
 * PostHog-based feature flag service with hybrid Redis/in-memory caching.
 *
 * This service evaluates feature flags via PostHog's API with a hybrid caching
 * strategy that uses Redis when available, falling back to in-memory cache.
 *
 * ## Architecture
 *
 * The service follows a stale-while-revalidate pattern:
 * 1. Check Redis cache first (shared across instances)
 * 2. Fall back to in-memory cache (per-instance)
 * 3. On cache miss, call PostHog API and cache result
 *
 * ## Targeting
 *
 * Flags can target users, projects, or organizations via personProperties:
 * - `distinctId` - The user ID (required)
 * - `projectId` - Optional project ID for project-level targeting
 * - `organizationId` - Optional organization ID for org-level targeting
 *
 * Configure targeting rules in PostHog release conditions.
 *
 * @see docs/adr/005-feature-flags.md for architecture decisions
 * @see FEATURE_FLAG_CACHE_TTL_MS for cache TTL configuration
 */
export class FeatureFlagServicePostHog implements FeatureFlagServiceInterface {
  private readonly posthog: ReturnType<typeof getPostHogInstance>;
  private readonly logger = createLogger(
    "langwatch:posthog-feature-flag-service",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.posthog-feature-flag-service",
  );

  private readonly cache = new StaleWhileRevalidateCache(
    FEATURE_FLAG_CACHE_TTL_MS,
    FEATURE_FLAG_CACHE_TTL_MS,
  );

  constructor() {
    this.posthog = getPostHogInstance();
  }

  /**
   * Static factory method for creating FeatureFlagServicePostHog.
   */
  static create(): FeatureFlagServicePostHog {
    return new FeatureFlagServicePostHog();
  }

  /**
   * Check if a feature flag is enabled for a given user or tenant/project.
   */
  async isEnabled(
    flagKey: string,
    distinctId: string,
    defaultValue = true,
    options?: FeatureFlagOptions,
  ): Promise<boolean> {
    return await this.tracer.withActiveSpan(
      "FeatureFlagServicePostHog.isEnabled",
      {
        attributes: {
          "feature.flag.key": flagKey,
          "feature.flag.distinct_id": distinctId,
          "feature.flag.default": defaultValue,
          "feature.flag.project_id": options?.projectId ?? "",
          "feature.flag.organization_id": options?.organizationId ?? "",
          "tenant.id": options?.projectId ?? "",
          "cache.redis_available": this.cache.isRedisAvailable(),
        },
      },
      async (span) => {
        if (!this.posthog) {
          span.setAttribute("feature.flag.source", "posthog-unavailable");
          return defaultValue;
        }

        const projectId = options?.projectId;
        const orgId = options?.organizationId;
        const cacheKey = `${flagKey}:${distinctId}:${projectId ?? ""}:${orgId ?? ""}`;

        // Check hybrid cache first
        const cachedResult = await this.cache.get(cacheKey);
        if (cachedResult !== undefined) {
          const cacheType = this.cache.isRedisAvailable() ? "redis" : "memory";
          span.setAttribute(
            "feature.flag.source",
            `posthog-cached-${cacheType}`,
          );
          span.setAttribute("feature.flag.enabled", cachedResult.value);
          return cachedResult.value;
        }

        try {
          // Build personProperties only with defined values
          const personProperties: Record<string, string> = {};
          if (projectId) {
            personProperties.project_id = projectId;
          }
          if (orgId) {
            personProperties.organization_id = orgId;
          }

          const posthogOptions = {
            disableGeoip: true,
            personProperties,
          };

          this.logger.debug(
            { flagKey, distinctId, posthogOptions },
            "Checking PostHog feature flag",
          );

          const isEnabled = await this.posthog.isFeatureEnabled(
            flagKey,
            distinctId,
            posthogOptions,
          );

          this.logger.debug(
            { flagKey, distinctId, isEnabled, posthogOptions },
            "PostHog feature flag result",
          );

          const result = isEnabled ?? defaultValue;
          await this.cache.set(cacheKey, result);

          span.setAttribute("feature.flag.source", "posthog");
          span.setAttribute("feature.flag.enabled", result);

          return result;
        } catch (error) {
          this.logger.warn(
            {
              flagKey,
              distinctId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to check PostHog feature flag, using default value",
          );
          span.setAttribute("feature.flag.source", "posthog-error");

          return defaultValue;
        }
      },
    );
  }

  /**
   * Clear the hybrid cache (both Redis and memory).
   */
  async clearCache(): Promise<void> {
    await this.cache.clear();
    this.logger.debug("Cleared hybrid feature flag cache");
  }

  /**
   * Check if PostHog is available.
   */
  isAvailable(): boolean {
    return this.posthog !== null;
  }

  /**
   * Check if Redis is available (false means using memory cache).
   */
  isRedisAvailable(): boolean {
    return this.cache.isRedisAvailable();
  }
}
