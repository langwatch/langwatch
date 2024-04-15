import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { TRACE_INDEX, esClient } from "../../elasticsearch";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { prisma } from "../../db";

export const limitsRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .query(async ({ input }) => {
      const { projectId } = input;

      const projectsCount = await getProjectLimits(projectId);
      const currentMonthMessagesCount =
        await getCurrentMonthMessagesCount(projectId);
      const currentMonthCost = await getCurrentMonthCost(projectId);

      return {
        projectsCount,
        currentMonthMessagesCount,
        currentMonthCost,
      };
    }),
});

const getCurrentMonth = () => {
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
};

export const getProjectLimits = async (projectId: string) => {
  return await prisma.project.count({
    where: { id: projectId },
  });
};

export const getCurrentMonthMessagesCount = async (projectId: string) => {
  const messagesCount = await esClient.count({
    index: TRACE_INDEX,
    body: {
      query: {
        bool: {
          must: [
            {
              term: {
                project_id: projectId,
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

export const getCurrentMonthCost = async (projectId: string) => {
  return (
    (
      await prisma.cost.aggregate({
        where: {
          projectId,
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
