import { z } from "zod";
import { OnboardingChecksService } from "~/server/onboarding-checks";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const integrationsChecksRouter = createTRPCRouter({
  getCheckStatus: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .query(async ({ input }) => {
      const onboardingService = new OnboardingChecksService();
      return onboardingService.getCheckStatus(input.projectId);
    }),
});
