import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

import { prisma } from "../../db";

export const integrationsChecksRouter = createTRPCRouter({
  getCheckStatus: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SETUP_PROJECT))
    .query(async ({ input }) => {
      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        include: {
          customGraphs: { orderBy: { createdAt: "desc" } },
          datasets: { orderBy: { createdAt: "desc" } },
          checks: { orderBy: { createdAt: "desc" } },
          triggers: { orderBy: { createdAt: "desc" } },
        },
      });

      const { customGraphs, datasets, checks, triggers } = project ?? {};

      return {
        customGraphs: customGraphs?.length,
        datasets: datasets?.length,
        evaluations: checks?.length,
        triggers: triggers?.length,
        firstMessage: project?.firstMessage,
        integrated: project?.integrated,
      };
    }),
});
