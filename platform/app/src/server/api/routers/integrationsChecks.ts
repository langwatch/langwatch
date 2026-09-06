import { z } from "zod";
import { OnboardingChecksService } from "~/server/onboarding-checks";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const integrationsChecksRouter = createTRPCRouter({
  getCheckStatus: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .permission("project:update")
    .query(async ({ input }) => {
      const onboardingService = new OnboardingChecksService();
      return onboardingService.getCheckStatus(input.projectId);
    }),
});
