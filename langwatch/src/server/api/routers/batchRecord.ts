import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

export const batchRecordRouter = createTRPCRouter({
  getAllByexperimentIdGroup: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const batchRecords = await prisma.batchProcessing.groupBy({
        by: ["experimentId", "datasetSlug"],
        where: { projectId },
        _count: {
          experimentId: true,
        },
        _sum: {
          cost: true,
        },
        _avg: {
          score: true,
        },
      });

      return batchRecords;
    }),
  getAllByexperimentId: protectedProcedure
    .input(z.object({ projectId: z.string(), experimentId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input, ctx }) => {
      const { projectId, experimentId } = input;
      const prisma = ctx.prisma;

      const batchRecords = await prisma.batchProcessing.findMany({
        where: {
          projectId: projectId,
          experimentId: experimentId,
        },
        include: {
          dataset: true,
        },
      });

      return batchRecords;
    }),
});
