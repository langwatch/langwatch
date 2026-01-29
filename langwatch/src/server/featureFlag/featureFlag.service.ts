import { env } from "~/env.mjs";
import { createLogger } from "~/utils/logger";
import { checkFlagEnvOverride } from "./envOverride";
import { FeatureFlagServiceMemory } from "./featureFlagService.memory";
import { FeatureFlagServicePostHog } from "./featureFlagService.posthog";
import type {
  FeatureFlagOptions,
  FeatureFlagServiceInterface,
} from "./types";

/**
 * Main feature flag service with automatic backend selection and env overrides.
 *
 * This is the primary entry point for feature flag evaluation. It automatically
 * selects the appropriate backend (PostHog or memory) based on environment
 * configuration and supports environment variable overrides for local development.
 *
 * ## Backend Selection
 *
 * - **PostHog** (production): Used when `POSTHOG_KEY` env var is set
 * - **Memory** (development): Fallback when PostHog is not configured
 *
 * ## Environment Overrides
 *
 * Flags can be force-enabled/disabled via environment variables:
 * - `FLAG_NAME=1` - Force enable (e.g., `RELEASE_UI_SIMULATIONS_MENU_ENABLED=1`)
 * - `FLAG_NAME=0` - Force disable
 *
 * Env overrides take precedence over PostHog evaluation.
 *
 * ## Usage
 *
 * ```typescript
 * // Use the singleton instance
 * import { featureFlagService } from "./featureFlag";
 *
 * const enabled = await featureFlagService.isEnabled(
 *   "release_ui_simulations_menu_enabled",
 *   userId,
 *   false, // defaultValue
 *   { projectId, organizationId }
 * );
 * ```
 *
 * @see docs/adr/005-feature-flags.md for architecture decisions
 * @see FeatureFlagServicePostHog for PostHog implementation details
 */
export class FeatureFlagService implements FeatureFlagServiceInterface {
  private readonly service: FeatureFlagServiceInterface;
  private readonly logger = createLogger("langwatch:feature-flag-service");

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
      this.logger.debug({ flagKey, distinctId, envOverride }, "Flag resolved via env override");
      return envOverride;
    }
    const result = await this.service.isEnabled(flagKey, distinctId, defaultValue, options);
    this.logger.debug({ flagKey, distinctId, enabled: result, projectId: options?.projectId, organizationId: options?.organizationId }, "Flag checked");
    return result;
  }

  /**
   * Create the appropriate service based on environment.
   */
  private createService(): FeatureFlagServiceInterface {
    // Use PostHog if the environment variable is set
    if (env.POSTHOG_KEY) {
      this.logger.info("Using PostHog feature flag service");
      return FeatureFlagServicePostHog.create();
    }

    this.logger.warn("POSTHOG_KEY not set, using memory feature flag service. All flags will return defaults. Set POSTHOG_KEY or use env overrides (e.g. RELEASE_UI_SIMULATIONS_MENU_ENABLED=1).");
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
