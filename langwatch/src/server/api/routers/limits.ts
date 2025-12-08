import { z } from "zod";
import { dependencies } from "../../../injection/dependencies.server";
import { prisma } from "../../db";
import { UsageLimitService } from "../../notifications/usage-limit.service";
import { TraceUsageService } from "../../traces/trace-usage.service";
import { getCurrentMonthStart } from "../../utils/dateUtils";
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

      const traceUsageService = TraceUsageService.create();
      const projectsCount = await getOrganizationProjectsCount(organizationId);
      const currentMonthMessagesCount =
        await traceUsageService.getCurrentMonthCount({ organizationId });
      const currentMonthCost = await getCurrentMonthCost(organizationId);
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

const getCurrentMonthCostForProjects = async (projectIds: string[]) => {
  return (
    (
      await prisma.cost.aggregate({
        where: {
          projectId: {
            in: projectIds,
          },
          createdAt: {
            gte: getCurrentMonthStart(),
          },
        },
        _sum: {
          amount: true,
        },
      })
    )._sum?.amount ?? 0
  );
};

/**
 * Get the maximum monthly usage limit for the organization.
 * FIXME: This was recently changed to return Infinity,
 * but still takes the organizationId as a parameter.
 *
 * Either we remove the organizationId parameter from all the calls to this function,
 * or we use to get the plan and return it correctly.
 *
 * @returns The maximum monthly usage limit for the organization.
 */
export const maxMonthlyUsageLimit = async (_organizationId: string) => {
  return Infinity;
};
