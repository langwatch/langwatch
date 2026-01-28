import { getLangWatchTracer } from "langwatch";
import { env } from "~/env.mjs";
import { createLogger } from "~/utils/logger";
import { checkFlagEnvOverride } from "./envOverride";
import { FeatureFlagServiceMemory } from "./featureFlagService.memory";
import { FeatureFlagServicePostHog } from "./featureFlagService.posthog";
import {
  FRONTEND_FEATURE_FLAGS,
  type FrontendFeatureFlag,
} from "./frontendFeatureFlags";
import type {
  FeatureFlagOptions,
  FeatureFlagServiceInterface,
} from "./types";

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
    options?: FeatureFlagOptions,
  ): Promise<boolean> {
    const envOverride = checkFlagEnvOverride(flagKey);
    if (envOverride !== undefined) {
      return envOverride;
    }
    return this.service.isEnabled(flagKey, distinctId, defaultValue, options);
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

  /**
   * Get enabled frontend feature flags for a user within a specific project.
   * Uses PostHog groups for project-level targeting.
   */
  async getEnabledProjectFeatures(
    userId: string,
    projectId: string,
  ): Promise<FrontendFeatureFlag[]> {
    const results = await Promise.all(
      FRONTEND_FEATURE_FLAGS.map(async (flag) => ({
        flag,
        enabled: await this.isEnabled(flag, userId, false, {
          groups: { project: projectId },
        }),
      })),
    );

    return results.filter((r) => r.enabled).map((r) => r.flag);
  }
}

/**
 * Default instance of the feature flag service.
 */
export const featureFlagService = FeatureFlagService.create();
