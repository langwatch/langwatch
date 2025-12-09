import { z } from "zod";
import { prisma } from "../../db";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const integrationsChecksRouter = createTRPCRouter({
  getCheckStatus: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .query(async ({ input }) => {
      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        include: {
          workflows: {
            select: { id: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          customGraphs: {
            select: { id: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          datasets: {
            select: { id: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          checks: {
            select: { id: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          triggers: {
            select: { id: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      const { workflows, customGraphs, datasets, checks, triggers } =
        project ?? {};

      return {
        workflows: workflows?.length,
        customGraphs: customGraphs?.length,
        datasets: datasets?.length,
        evaluations: checks?.length,
        triggers: triggers?.length,
        firstMessage: project?.firstMessage,
        integrated: project?.integrated,
      };
    }),
});
