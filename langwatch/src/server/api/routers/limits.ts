import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  OrganizationRoleGroup,
  checkUserPermissionForOrganization,
} from "../permission";
import { TRACE_INDEX, esClient } from "../../elasticsearch";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { prisma } from "../../db";
import { dependencies } from "../../../injection/dependencies.server";

export const limitsRouter = createTRPCRouter({
  getUsage: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_USAGE
      )
    )
    .query(async ({ input, ctx }) => {
      const { organizationId } = input;

      const projectIds = (
        await prisma.project.findMany({
          where: {
            team: { organizationId },
          },
          select: { id: true },
        })
      ).map((project) => project.id);

      const projectsCount = projectIds.length;
      const currentMonthMessagesCount =
        await getCurrentMonthMessagesCount(projectIds);
      const currentMonthCost = await getCurrentMonthCostForProjects(projectIds);
      const activePlan = await dependencies.subscriptionHandler.getActivePlan(
        organizationId,
        ctx.session.user
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
});

const getCurrentMonth = () => {
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
};

export const getOrganizationProjectsCount = async (organizationId: string) => {
  return await prisma.project.count({
    where: {
      team: { organizationId },
    },
  });
};

export const getCurrentMonthMessagesCount = async (projectIds: string[]) => {
  const client = await esClient();
  const messagesCount = await client.count({
    index: TRACE_INDEX.alias,
    body: {
      query: {
        bool: {
          must: [
            {
              terms: {
                project_id: projectIds,
              },
            },
            {
              range: {
                "timestamps.inserted_at": {
                  gte: getCurrentMonth().getTime(),
                },
              },
            },
          ] as QueryDslBoolQuery["filter"],
        } as QueryDslBoolQuery,
      },
    },
  });

  return messagesCount.count;
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
            gte: getCurrentMonth(),
          },
        },
        _sum: {
          amount: true,
        },
      })
    )._sum?.amount ?? 0
  );
};

export const maxMonthlyUsageLimit = async (organizationId: string) => {
  const activePlan =
    await dependencies.subscriptionHandler.getActivePlan(organizationId);
  if (activePlan.name === "Open Source") {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    return organization?.usageSpendingMaxLimit ?? Infinity;
  }
  if (activePlan.evaluationsCredit < 10) {
    return activePlan.evaluationsCredit;
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  // TODO: improve this logic to be based on subscription history
  const maxLimitAccordingToSubscription = activePlan.prices.USD;
  const maxLimitAccordingToUser =
    organization?.usageSpendingMaxLimit ?? maxLimitAccordingToSubscription;

  return Math.min(maxLimitAccordingToSubscription, maxLimitAccordingToUser);
};
