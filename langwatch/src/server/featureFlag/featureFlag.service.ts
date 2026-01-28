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
    this.logger.debug({ flagKey, distinctId, enabled: result, groups: options?.groups }, "Flag checked");
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
        enabled: await this.isEnabled(flag, userId, false, {
          groups: { user: userId },
        }),
      })),
    );

    const enabled = results.filter((r) => r.enabled).map((r) => r.flag);
    this.logger.info({ userId, enabledFeatures: enabled }, "User frontend features resolved");
    return enabled;
  }

  /**
   * Get enabled frontend feature flags for a user within a specific project.
   * Uses PostHog groups for project-level targeting.
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
          groups: { user: userId, project: projectId, organization: organizationId },
        }),
      })),
    );

    const enabled = results.filter((r) => r.enabled).map((r) => r.flag);
    this.logger.info({ userId, projectId, organizationId, enabledFeatures: enabled }, "Project features resolved");
    return enabled;
  }

  /**
   * Get all session features for a user (user-level and project-level).
   * Fetches user's projects and checks feature flags for each.
   */
  async getSessionFeatures(
    userId: string,
    prisma: PrismaClient,
  ): Promise<{
    enabledFeatures: FrontendFeatureFlag[];
    projectFeatures: Record<string, FrontendFeatureFlag[]>;
  }> {
    const userProjects = await prisma.project.findMany({
      where: {
        team: { members: { some: { userId } }, archivedAt: null },
        archivedAt: null,
      },
      select: { id: true, team: { select: { organizationId: true } } },
    });

    const [enabledFeatures, projectResults] = await Promise.all([
      this.getEnabledFrontendFeatures(userId),
      Promise.all(
        userProjects.map(async (project) => ({
          projectId: project.id,
          features: await this.getEnabledProjectFeatures(
            userId,
            project.id,
            project.team.organizationId ?? undefined,
          ),
        })),
      ),
    ]);

    this.logger.info(
      { userId, projectCount: userProjects.length },
      "Session features resolved",
    );

    return {
      enabledFeatures,
      projectFeatures: Object.fromEntries(
        projectResults.map((r) => [r.projectId, r.features]),
      ),
    };
  }
}

/**
 * Default instance of the feature flag service.
 */
export const featureFlagService = FeatureFlagService.create();
