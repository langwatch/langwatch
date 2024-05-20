import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { nanoid } from "nanoid";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

export const graphsRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({ projectId: z.string(), name: z.string(), graph: z.string() })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const graph = JSON.parse(input.graph);

      return ctx.prisma.customGraph.create({
        data: {
          id: nanoid(),
          name: input.name,
          graph: graph,
          projectId: input.projectId,
        },
      });
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const datasets = await prisma.customGraph.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      });

      return datasets;
    }),
  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const { id } = input;
      const prisma = ctx.prisma;

      const graph = await prisma.customGraph.findUnique({
        where: { id, projectId: input.projectId },
      });
      if (!graph) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Graph not found" });
      }

      await prisma.customGraph.delete({ where: { id, projectId: input.projectId } });

      return graph;
    }),
});
