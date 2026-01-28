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

  // Stale-while-revalidate cache: 5 min stale threshold, 30 sec refresh threshold
  private readonly cache = new StaleWhileRevalidateCache(
    1 * 60 * 1000,
    1 * 30 * 1000,
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
          "feature.flag.project": options?.groups?.project ?? "",
          "feature.flag.organization": options?.groups?.organization ?? "",
          "cache.redis_available": this.cache.isRedisAvailable(),
        },
      },
      async (span) => {
        if (!this.posthog) {
          span.setAttribute("feature.flag.source", "posthog-unavailable");
          return defaultValue;
        }

        const projectKey = options?.groups?.project ?? "";
        const orgKey = options?.groups?.organization ?? "";
        const cacheKey = `${flagKey}:${distinctId}:${projectKey}:${orgKey}`;

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
          // Fetch from PostHog
          const isEnabled = await this.posthog.isFeatureEnabled(
            flagKey,
            distinctId,
            {
              disableGeoip: true,
              groups: options?.groups,
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
