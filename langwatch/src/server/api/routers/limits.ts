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

      const projectsCount = await getProjectLimits(projectIds);
      const currentMonthMessagesCount =
        await getCurrentMonthMessagesCount(projectIds);
      const currentMonthCost = await getCurrentMonthCost(projectIds);
      const activePlan = await dependencies.subscriptionHandler.getActivePlan(
        organizationId,
        ctx.session.user
      );

      return {
        projectsCount,
        currentMonthMessagesCount,
        currentMonthCost,
        activePlan,
      };
    }),
});

const getCurrentMonth = () => {
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
};

export const getProjectLimits = async (projectIds: string[]) => {
  return await prisma.project.count({
    where: {
      id: {
        in: projectIds,
      },
    },
  });
};

export const getCurrentMonthMessagesCount = async (projectIds: string[]) => {
  const messagesCount = await esClient.count({
    index: TRACE_INDEX,
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

export const getCurrentMonthCost = async (projectIds: string[]) => {
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
