import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger";
import { getPostHogInstance } from "../posthog";
import { StaleWhileRevalidateCache } from "./staleWhileRevalidateCache.redis";
import type {
  FeatureFlagOptions,
  FeatureFlagServiceInterface,
} from "./types";

/**
 * PostHog-based feature flag service with hybrid Redis/in-memory caching.
 */
export class FeatureFlagServicePostHog implements FeatureFlagServiceInterface {
  private readonly posthog: ReturnType<typeof getPostHogInstance>;
  private readonly logger = createLogger(
    "langwatch:posthog-feature-flag-service",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.posthog-feature-flag-service",
  );

  // Cache TTL: 5 seconds for fast kill switch response
  private readonly cache = new StaleWhileRevalidateCache(
    5 * 1000,
    5 * 1000,
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
          "cache.redis_available": this.cache.isRedisAvailable(),
        },
      },
      async (span) => {
        if (!this.posthog) {
          span.setAttribute("feature.flag.source", "posthog-unavailable");
          return defaultValue;
        }

        const projectId = options?.projectId ?? "";
        const orgId = options?.organizationId ?? "";
        const cacheKey = `${flagKey}:${distinctId}:${projectId}:${orgId}`;

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
          // Fetch from PostHog with personProperties for flexible targeting
          const isEnabled = await this.posthog.isFeatureEnabled(
            flagKey,
            distinctId,
            {
              disableGeoip: true,
              personProperties: {
                project_id: projectId,
                organization_id: orgId,
              },
            },
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
