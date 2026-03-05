import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import type { FeatureFlagOptions, FeatureFlagServiceInterface } from "./types";

/**
 * In-memory feature flag service with default values.
 */
export class FeatureFlagServiceMemory implements FeatureFlagServiceInterface {
  private readonly logger = createLogger(
    "langwatch:memory-feature-flag-service",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.memory-feature-flag-service",
  );

  // In-memory feature flags storage
  private readonly flags: Record<string, boolean> = {};

  constructor() {
    this.initializeFlags();
  }

  /**
   * Static factory method for creating FeatureFlagServiceMemory.
   */
  static create(): FeatureFlagServiceMemory {
    return new FeatureFlagServiceMemory();
  }

  /**
   * Check if a feature flag is enabled.
   * Note: options parameter is accepted for interface compatibility but ignored.
   */
  async isEnabled(
    flagKey: string,
    distinctId: string,
    defaultValue = true,
    _options?: FeatureFlagOptions,
  ): Promise<boolean> {
    return await this.tracer.withActiveSpan(
      "FeatureFlagServiceMemory.isEnabled",
      {
        attributes: {
          "feature.flag.key": flagKey,
          "feature.flag.distinct_id": distinctId,
          "feature.flag.default": defaultValue,
        },
      },
      async (span) => {
        const isEnabled = this.getFlag(flagKey, defaultValue);
        span.setAttribute("feature.flag.source", "memory");
        span.setAttribute("feature.flag.enabled", isEnabled);
        return isEnabled;
      },
    );
  }

  /**
   * Get multiple feature flags at once.
   */
  async getMultiple(
    flagKeys: string[],
    distinctId: string,
    defaults: Record<string, boolean> = {},
  ): Promise<Record<string, boolean>> {
    return await this.tracer.withActiveSpan(
      "FeatureFlagServiceMemory.getMultiple",
      {
        attributes: {
          "feature.flag.keys": flagKeys.join(","),
          "feature.flag.distinct_id": distinctId,
        },
      },
      async (span) => {
        const results: Record<string, boolean> = {};

        for (const flagKey of flagKeys) {
          const defaultValue = defaults[flagKey] ?? true;
          results[flagKey] = this.getFlag(flagKey, defaultValue);
        }

        span.setAttribute(
          "feature.flag.results_count",
          Object.keys(results).length,
        );
        return results;
      },
    );
  }

  /**
   * Force enable or disable a feature flag (useful for testing).
   */
  setFlag(flagKey: string, enabled: boolean): void {
    this.flags[flagKey] = enabled;
    this.logger.debug({ flagKey, enabled }, "Set in-memory feature flag");
  }

  /**
   * Reset a feature flag to its default state.
   */
  resetFlag(flagKey: string): void {
    delete this.flags[flagKey];
    this.logger.debug({ flagKey }, "Reset in-memory feature flag");
  }

  /**
   * Get all current flag values (useful for debugging).
   */
  getAllFlags(): Record<string, boolean> {
    return { ...this.flags };
  }

  /**
   * Initialize flags with default values.
   */
  private initializeFlags(): void {
    // Flags that should default to enabled in local dev (no PostHog)
    this.flags["release_ui_sdk_radar_banner_card_enabled"] = true;

    this.logger.debug("Initialized in-memory feature flags");
  }

  /**
   * Get a flag value, using default if not set.
   */
  private getFlag(flagKey: string, defaultValue: boolean): boolean {
    return this.flags[flagKey] ?? defaultValue;
  }
}
