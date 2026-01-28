import { z } from "zod";
import { prisma } from "../../db";
import { UsageStatsService } from "../../license-enforcement/usage-stats.service";
import { UsageLimitService } from "../../notifications/usage-limit.service";
import {
  checkUserPermissionForOrganization,
  OrganizationRoleGroup,
} from "../permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const limitsRouter = createTRPCRouter({
  getUsage: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_USAGE,
      ),
    )
    .query(async ({ input, ctx }) => {
      const { organizationId } = input;
      const service = UsageStatsService.create(prisma);
      return service.getUsageStats(organizationId, ctx.session.user);
    }),
  checkAndSendUsageLimitNotification: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        currentMonthMessagesCount: z.number(),
        maxMonthlyUsageLimit: z.number(),
      }),
    )
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_USAGE,
      ),
    )
    .mutation(async ({ input }) => {
      const service = UsageLimitService.create(prisma);
      const notification = await service.checkAndSendWarning({
        organizationId: input.organizationId,
        currentMonthMessagesCount: input.currentMonthMessagesCount,
        maxMonthlyUsageLimit: input.maxMonthlyUsageLimit,
      });

      return {
        sent: notification !== null,
        notificationId: notification?.id,
        sentAt: notification?.sentAt,
      };
    }),
});

export const getOrganizationProjectsCount = async (organizationId: string) => {
  return await prisma.project.count({
    where: {
      team: { organizationId },
    },
  });
};
