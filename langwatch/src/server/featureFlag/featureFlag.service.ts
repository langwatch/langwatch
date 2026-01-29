import type { PrismaClient } from "@prisma/client";
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

    this.logger.warn("POSTHOG_KEY not set, using memory feature flag service. All flags will return defaults. Set POSTHOG_KEY or use env overrides (e.g. UI_SIMULATIONS_SCENARIOS=1).");
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

    const enabled = results.filter((r) => r.enabled).map((r) => r.flag);
    this.logger.info({ userId, enabledFeatures: enabled }, "User frontend features resolved");
    return enabled;
  }

  /**
   * Get enabled frontend feature flags for a user within a specific project.
   * Uses personProperties for flexible targeting by user, project, or organization.
   */
  async getEnabledProjectFeatures(
    userId: string,
    projectId: string,
    organizationId?: string,
  ): Promise<FrontendFeatureFlag[]> {
    const results = await Promise.all(
      FRONTEND_FEATURE_FLAGS.map(async (flag) => ({
        flag,
        enabled: await this.isEnabled(flag, userId, false, {
          projectId,
          organizationId,
        }),
      })),
    );

    const enabled = results.filter((r) => r.enabled).map((r) => r.flag);
    this.logger.info({ userId, projectId, organizationId, enabledFeatures: enabled }, "Project features resolved");
    return enabled;
  }

  /**
   * Get all session features for a user.
   * Checks flags against all user's projects/orgs - if ANY match, flag is enabled.
   */
  async getSessionFeatures(
    userId: string,
    prisma: PrismaClient,
  ): Promise<FrontendFeatureFlag[]> {
    const userProjects = await prisma.project.findMany({
      where: {
        team: { members: { some: { userId } }, archivedAt: null },
        archivedAt: null,
      },
      select: { id: true, team: { select: { organizationId: true } } },
    });

    // Check each flag against all user's project/org contexts
    // If ANY context returns true, the flag is enabled
    const enabledFlags = new Set<FrontendFeatureFlag>();

    await Promise.all(
      FRONTEND_FEATURE_FLAGS.map(async (flag) => {
        // Check user-level first (no project context)
        if (await this.isEnabled(flag, userId, false)) {
          enabledFlags.add(flag);
          return;
        }

        // Check each project context
        for (const project of userProjects) {
          if (await this.isEnabled(flag, userId, false, {
            projectId: project.id,
            organizationId: project.team.organizationId ?? undefined,
          })) {
            enabledFlags.add(flag);
            return; // Found a match, no need to check more projects
          }
        }
      }),
    );

    const enabledFeatures = Array.from(enabledFlags);
    this.logger.info(
      { userId, projectCount: userProjects.length, enabledFeatures },
      "Session features resolved",
    );

    return enabledFeatures;
  }
}

/**
 * Default instance of the feature flag service.
 */
export const featureFlagService = FeatureFlagService.create();
