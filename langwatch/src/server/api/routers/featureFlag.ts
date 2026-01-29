import { z } from "zod";
import { createLogger } from "~/utils/logger";
import { featureFlagService } from "../../featureFlag";
import { FRONTEND_FEATURE_FLAGS } from "../../featureFlag/frontendFeatureFlags";
import { skipPermissionCheck } from "../permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const logger = createLogger("langwatch:feature-flag-router");

const frontendFeatureFlagSchema = z.enum([
  ...FRONTEND_FEATURE_FLAGS,
] as [string, ...string[]]);

/**
 * tRPC router for feature flag checks.
 *
 * Uses PostHog for flag evaluation with optional project/organization targeting.
 * Results are cached server-side (5s TTL) and client-side (React Query).
 *
 * @see docs/adr/005-feature-flags.md for architecture decisions
 */
export const featureFlagRouter = createTRPCRouter({
  /**
   * Check if a feature flag is enabled for the current user.
   *
   * @param flag - The feature flag key (must be in FRONTEND_FEATURE_FLAGS)
   * @param projectId - Optional project ID for project-level targeting
   * @param organizationId - Optional organization ID for org-level targeting
   * @returns { enabled: boolean }
   */
  isEnabled: protectedProcedure
    .input(
      z.object({
        flag: frontendFeatureFlagSchema,
        projectId: z.string().optional(),
        organizationId: z.string().optional(),
      }),
    )
    .use(skipPermissionCheck({
      allow: {
        projectId: "for PostHog targeting, not resource access",
        organizationId: "for PostHog targeting, not resource access",
      },
    }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      logger.debug(
        { userId, flag: input.flag, projectId: input.projectId, organizationId: input.organizationId },
        "Feature flag check requested",
      );

      const enabled = await featureFlagService.isEnabled(
        input.flag,
        userId,
        false,
        {
          projectId: input.projectId,
          organizationId: input.organizationId,
        },
      );

      logger.debug(
        { userId, flag: input.flag, enabled },
        "Feature flag check result",
      );

      return { enabled };
    }),
});
