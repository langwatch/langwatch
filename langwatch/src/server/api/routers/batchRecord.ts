import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

export const batchRecordRouter = createTRPCRouter({
  getAllByBatchIDGroup: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const batchRecords = await prisma.batchProcessing.groupBy({
        by: ["batchId", "datasetSlug"],
        where: { projectId },
        _count: {
          batchId: true,
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
  getAllByBatchID: protectedProcedure
    .input(z.object({ projectId: z.string(), batchId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.DATASETS_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId, batchId } = input;
      const prisma = ctx.prisma;

      const batchRecords = await prisma.batchProcessing.findMany({
        where: {
          projectId: projectId,
          batchId: batchId,
        },
        include: {
          dataset: true,
        },
      });

      return batchRecords;
    }),
});
