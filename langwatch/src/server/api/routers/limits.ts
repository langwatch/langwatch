import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  OrganizationRoleGroup,
  checkUserPermissionForOrganization,
} from "../permission";
import { dependencies } from "../../../injection/dependencies.server";
import { UsageLimitService } from "../../notifications/usage-limit.service";
import {
  getProjectIdsForOrganization,
  getCurrentMonthMessagesCount,
  getCurrentMonthCostForProjects,
  maxMonthlyUsageLimit,
} from "./limits.utils";

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

      const projectIds = await getProjectIdsForOrganization(organizationId);

      const projectsCount = projectIds.length;
      const currentMonthMessagesCount =
        await getCurrentMonthMessagesCount(projectIds);
      const currentMonthCost = await getCurrentMonthCostForProjects(projectIds);
      const activePlan = await dependencies.subscriptionHandler.getActivePlan(
        organizationId,
        ctx.session.user,
      );
      const maxMonthlyUsageLimit_ = await maxMonthlyUsageLimit(organizationId);

      return {
        projectsCount,
        currentMonthMessagesCount,
        currentMonthCost,
        activePlan,
        maxMonthlyUsageLimit: maxMonthlyUsageLimit_,
      };
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

export const getCurrentMonthCost = async (organizationId: string) => {
  const projectIds = (
    await prisma.project.findMany({
      where: {
        team: { organizationId },
      },
      select: { id: true },
    })
  ).map((project) => project.id);

  return getCurrentMonthCostForProjects(projectIds);
};
