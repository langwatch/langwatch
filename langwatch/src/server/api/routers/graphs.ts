import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { type FilterField, filterFieldsEnum } from "../../filters/types";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const graphsRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        graph: z.string(),
        filterParams: z.any().optional(),
        dashboardId: z.string().optional(),
        gridColumn: z.number().min(0).max(1).optional(),
        gridRow: z.number().min(0).optional(),
        colSpan: z.number().min(1).max(2).optional(),
        rowSpan: z.number().min(1).max(2).optional(),
      }),
    )
    .use(checkProjectPermission("analytics:create"))
    .mutation(async ({ ctx, input }) => {
      const graph = JSON.parse(input.graph);

      // If no gridRow provided, find the next available row
      let gridRow = input.gridRow;
      if (gridRow === undefined && input.dashboardId) {
        const lastGraph = await ctx.prisma.customGraph.findFirst({
          where: { dashboardId: input.dashboardId, projectId: input.projectId },
          orderBy: { gridRow: "desc" },
        });
        gridRow = (lastGraph?.gridRow ?? -1) + 1;
      }

      return ctx.prisma.customGraph.create({
        data: {
          id: nanoid(),
          name: input.name,
          graph: graph,
          projectId: input.projectId,
          filters: input.filterParams?.filters ?? {},
          dashboardId: input.dashboardId,
          gridColumn: input.gridColumn ?? 0,
          gridRow: gridRow ?? 0,
          colSpan: input.colSpan ?? 1,
          rowSpan: input.rowSpan ?? 1,
        },
      });
    }),
  getAll: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dashboardId: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("analytics:view"))
    .query(async ({ input, ctx }) => {
      const { projectId, dashboardId } = input;
      const prisma = ctx.prisma;

      const graphs = await prisma.customGraph.findMany({
        where: {
          projectId,
          ...(dashboardId ? { dashboardId } : {}),
        },
        orderBy: dashboardId
          ? [{ gridRow: "asc" }, { gridColumn: "asc" }]
          : { createdAt: "desc" },
      });

      return graphs;
    }),
  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(checkProjectPermission("analytics:delete"))
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
    .use(checkProjectPermission("analytics:view"))
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
        const validFilters: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(graph.filters)) {
          if (filterFieldsEnum.safeParse(key).success) {
            if (
              Array.isArray(value) ||
              (typeof value === "object" && value !== null)
            ) {
              validFilters[key] = value;
            }
          }
        }

        validatedFilters =
          Object.keys(validFilters).length > 0
            ? (validFilters as Record<
                FilterField,
                string[] | Record<string, string[]>
              >)
            : undefined;
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
      }),
    )
    .use(checkProjectPermission("analytics:update"))
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

  updateLayout: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        graphId: z.string(),
        gridColumn: z.number().min(0).max(1),
        gridRow: z.number().min(0),
        colSpan: z.number().min(1).max(2),
        rowSpan: z.number().min(1).max(2),
      }),
    )
    .use(checkProjectPermission("analytics:update"))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.customGraph.update({
        where: { id: input.graphId, projectId: input.projectId },
        data: {
          gridColumn: input.gridColumn,
          gridRow: input.gridRow,
          colSpan: input.colSpan,
          rowSpan: input.rowSpan,
        },
      });
    }),

  batchUpdateLayouts: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        layouts: z.array(
          z.object({
            graphId: z.string(),
            gridColumn: z.number().min(0).max(1),
            gridRow: z.number().min(0),
            colSpan: z.number().min(1).max(2),
            rowSpan: z.number().min(1).max(2),
          }),
        ),
      }),
    )
    .use(checkProjectPermission("analytics:update"))
    .mutation(async ({ ctx, input }) => {
      const updates = input.layouts.map((layout) =>
        ctx.prisma.customGraph.update({
          where: { id: layout.graphId, projectId: input.projectId },
          data: {
            gridColumn: layout.gridColumn,
            gridRow: layout.gridRow,
            colSpan: layout.colSpan,
            rowSpan: layout.rowSpan,
          },
        }),
      );

      await ctx.prisma.$transaction(updates);

      return { success: true };
    }),
});
