import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { TRPCError } from "@trpc/server";

export const batchRecordRouter = createTRPCRouter({
  getAllByexperimentIdGroup: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const batchRecords = await prisma.batchEvaluation.groupBy({
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
  getAllByexperimentSlug: protectedProcedure
    .input(z.object({ projectId: z.string(), experimentSlug: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input, ctx }) => {
      const { projectId, experimentSlug } = input;
      const prisma = ctx.prisma;

      const experiment = await prisma.experiment.findUnique({
        where: {
          projectId_slug: {
            projectId,
            slug: experimentSlug,
          },
        },
      });

      if (!experiment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment not found",
        });
      }

      const batchRecords = await prisma.batchEvaluation.findMany({
        where: {
          projectId: projectId,
          experimentId: experiment.id,
        },
        include: {
          dataset: true,
        },
      });

      return batchRecords;
    }),
});
