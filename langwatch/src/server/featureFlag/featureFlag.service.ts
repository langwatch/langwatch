import { getLangWatchTracer } from "langwatch";
import { env } from "~/env.mjs";
import { createLogger } from "~/utils/logger";
import { FeatureFlagServiceMemory } from "./featureFlagService.memory";
import { FeatureFlagServicePostHog } from "./featureFlagService.posthog";
import {
  FRONTEND_FEATURE_FLAGS,
  type FrontendFeatureFlag,
} from "./frontendFeatureFlags";
import type { FeatureFlagServiceInterface } from "./types";

/**
 * Feature flag service that automatically chooses between PostHog and memory
 * based on environment configuration.
 */
export class FeatureFlagService implements FeatureFlagServiceInterface {
  private readonly service: FeatureFlagServiceInterface;
  private readonly logger = createLogger("langwatch:feature-flag-service");
  private readonly _tracer = getLangWatchTracer(
    "langwatch.feature-flag-service",
  );

  constructor() {
    this.service = this.createService();
  }

  /**
   * Static factory method for creating FeatureFlagService with default dependencies.
   */
  static create(): FeatureFlagService {
    return new FeatureFlagService();
  }

  /**
   * Check if a feature flag is enabled for a given user or tenant/project.
   * Environment overrides take precedence over PostHog/memory service.
   */
  async isEnabled(
    flagKey: string,
    distinctId: string,
    defaultValue = true,
  ): Promise<boolean> {
    const envOverride = this.checkEnvOverride(flagKey);
    if (envOverride !== undefined) {
      return envOverride;
    }
    return this.service.isEnabled(flagKey, distinctId, defaultValue);
  }

  /**
   * Check if a flag is overridden by environment variable.
   * Format: FEATURE_FLAG_NAME=1 (enabled) or FEATURE_FLAG_NAME=0 (disabled)
   * Flag name is uppercased with dashes replaced by underscores.
   * Example: ui-simulations-scenarios -> UI_SIMULATIONS_SCENARIOS=1
   */
  private checkEnvOverride(flagKey: string): boolean | undefined {
    const envKey = flagKey.toUpperCase().replace(/-/g, "_");
    const envValue = process.env[envKey];

    if (envValue === "1") {
      return true;
    }
    if (envValue === "0") {
      return false;
    }
    return undefined;
  }

  /**
   * Create the appropriate service based on environment.
   */
  private createService(): FeatureFlagServiceInterface {
    // Use PostHog if the environment variable is set
    if (env.POSTHOG_KEY) {
      this.logger.debug("Using PostHog feature flag service");
      return FeatureFlagServicePostHog.create();
    }

    this.logger.debug("Using memory feature flag service");
    return FeatureFlagServiceMemory.create();
  }

  /**
   * Get the underlying service (useful for testing or advanced operations).
   */
  getService(): FeatureFlagServiceInterface {
    return this.service;
  }

  /**
   * Get enabled frontend feature flags for a user.
   * Checks all flags in parallel for performance.
   */
  async getEnabledFrontendFeatures(
    userId: string,
  ): Promise<FrontendFeatureFlag[]> {
    const results = await Promise.all(
      FRONTEND_FEATURE_FLAGS.map(async (flag) => ({
        flag,
        enabled: await this.isEnabled(flag, userId, false),
      })),
    );

    return results.filter((r) => r.enabled).map((r) => r.flag);
  }
}

/**
 * Default instance of the feature flag service.
 */
export const featureFlagService = FeatureFlagService.create();
