import { z } from "zod";
import { featureFlagService } from "../../featureFlag";
import { FRONTEND_FEATURE_FLAGS } from "../../featureFlag/frontendFeatureFlags";
import { skipPermissionCheck } from "../permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const frontendFeatureFlagSchema = z.enum([
  ...FRONTEND_FEATURE_FLAGS,
] as [string, ...string[]]);

export const featureFlagRouter = createTRPCRouter({
  isEnabled: protectedProcedure
    .input(
      z.object({
        flag: frontendFeatureFlagSchema,
        projectId: z.string().optional(),
        organizationId: z.string().optional(),
      }),
    )
    .use(skipPermissionCheck)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const enabled = await featureFlagService.isEnabled(
        input.flag,
        userId,
        false,
        {
          projectId: input.projectId,
          organizationId: input.organizationId,
        },
      );

      return { enabled };
    }),
});
