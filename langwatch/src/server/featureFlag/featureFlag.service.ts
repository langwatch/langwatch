import { getLangWatchTracer } from "langwatch";
import { env } from "~/env.mjs";
import { createLogger } from "~/utils/logger";
import { FeatureFlagServiceMemory } from "./featureFlagService.memory";
import { FeatureFlagServicePostHog } from "./featureFlagService.posthog";
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
   * Check if a flag is overridden by environment variables.
   * FEATURE_FLAGS_ENABLED=flag1,flag2 - force enable flags
   * FEATURE_FLAGS_DISABLED=flag1,flag2 - force disable flags
   */
  private checkEnvOverride(flagKey: string): boolean | undefined {
    const enabledFlags = process.env.FEATURE_FLAGS_ENABLED?.split(",") ?? [];
    const disabledFlags = process.env.FEATURE_FLAGS_DISABLED?.split(",") ?? [];

    if (enabledFlags.includes(flagKey)) {
      return true;
    }
    if (disabledFlags.includes(flagKey)) {
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
}

/**
 * Default instance of the feature flag service.
 */
export const featureFlagService = FeatureFlagService.create();
