import { z } from "zod";
import { prisma } from "../../db";
import { UsageStatsService } from "../../license-enforcement/usage-stats.service";
import { getApp } from "../../app-layer/app";
import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const limitsRouter = createTRPCRouter({
  getUsage: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
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
    // Tightened from organization:view to manage — this mutation
    // takes caller-supplied counts + limits and sends a usage-limit
    // email to org admins. A non-admin should not be able to trigger
    // an admin-targeted notification with arbitrary numbers (a low-
    // impact spam vector). Zero TS callers, so the bump is invisible
    // to legitimate UX.
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input }) => {
      const notification = await getApp().usageLimits.checkAndSendWarning({
        organizationId: input.organizationId,
        currentMonthMessagesCount: input.currentMonthMessagesCount,
        maxMonthlyUsageLimit: input.maxMonthlyUsageLimit,
      });

      return {
        sent: notification !== null && notification !== undefined,
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
