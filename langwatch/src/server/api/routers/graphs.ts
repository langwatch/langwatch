import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { nanoid } from "nanoid";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { filterFieldsEnum, type FilterField } from "../../filters/types";

export const graphsRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        graph: z.string(),
        filterParams: z.any().optional(),
      })
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
          filters: input.filterParams?.filters ?? {},
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

      await prisma.customGraph.delete({
        where: { id, projectId: input.projectId },
      });

      return graph;
    }),
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
    .query(async ({ ctx, input }) => {
      const { id } = input;
      const prisma = ctx.prisma;

      const graph = await prisma.customGraph.findUnique({
        where: { id, projectId: input.projectId },
      });

      if (!graph) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Graph not found" });
      }

      // Basic validation to ensure filters have the expected structure
      let validatedFilters:
        | Record<FilterField, string[] | Record<string, string[]>>
        | undefined;

      if (graph.filters && typeof graph.filters === "object") {
        const validFilters: Record<string, any> = {};

        for (const [key, value] of Object.entries(graph.filters)) {
          // Only include valid FilterField keys
          if (filterFieldsEnum.safeParse(key).success) {
            // Basic validation of the value structure
            if (
              Array.isArray(value) ||
              (typeof value === "object" && value !== null)
            ) {
              validFilters[key] = value;
            }
          }
        }

        validatedFilters = validFilters as Record<
          FilterField,
          string[] | Record<string, string[]>
        >;
      } else {
        validatedFilters = undefined;
      }

      return {
        ...graph,
        filters: validatedFilters,
      };
    }),
  updateById: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        graph: z.string(),
        graphId: z.string(),
        filterParams: z.any().optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const prisma = ctx.prisma;

      return prisma.customGraph.update({
        where: { id: input.graphId, projectId: input.projectId },
        data: {
          name: input.name,
          graph: JSON.parse(input.graph),
          filters: input.filterParams?.filters ?? {},
        },
      });
    }),
});
