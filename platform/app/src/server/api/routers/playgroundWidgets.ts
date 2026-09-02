/**
 * Persistence for custom-chart-playground widgets.
 *
 * A thin, project-scoped CRUD router over `CustomGraph` rows of kind
 * {@link PLAYGROUND_SRCDOC_CHART_KIND}. Every read and write filters by that
 * kind alongside `projectId`, so a playground widget is never read, updated or
 * deleted through the builder or workbench paths — and neither of those ever
 * sees a playground row. The `graph` column holds a
 * {@link PlaygroundWidgetDefinition} — see that module for the shape and why
 * it is versioned.
 *
 * Deliberately independent of `graphs.ts`: the playground stores a sandboxed
 * author file plus the named queries it runs, not a builder payload or a
 * validated workbench definition, so it borrows the grid columns and nothing
 * else.
 */

import { nanoid } from "nanoid";
import { z } from "zod";

import type { Prisma } from "~/generated/prisma/client";
import { PLAYGROUND_SRCDOC_CHART_KIND } from "~/server/analytics/chartKinds";
import {
  PLAYGROUND_WIDGET_DEFINITION_VERSION,
  type PlaygroundWidgetDefinition,
  playgroundQuerySchema,
} from "~/server/analytics/playgroundWidgetDefinition";

import { createTRPCRouter, protectedProcedure } from "../trpc";

const layoutSchema = z.object({
  gridColumn: z.number().min(0).max(1),
  gridRow: z.number().min(0),
  colSpan: z.number().min(1).max(2),
  rowSpan: z.number().min(1).max(2),
});

const graphOf = (input: {
  code: string;
  queries: PlaygroundWidgetDefinition["queries"];
}): Prisma.InputJsonValue => ({
  version: PLAYGROUND_WIDGET_DEFINITION_VERSION,
  code: input.code,
  queries: input.queries,
});

export const playgroundWidgetsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("analytics:view")
    .query(async ({ ctx, input }) => {
      return await ctx.prisma.customGraph.findMany({
        where: {
          projectId: input.projectId,
          kind: PLAYGROUND_SRCDOC_CHART_KIND,
        },
        orderBy: [{ gridRow: "asc" }, { gridColumn: "asc" }],
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dashboardId: z.string().optional(),
        name: z.string(),
        code: z.string(),
        queries: z.array(playgroundQuerySchema),
      }),
    )
    .permission("analytics:create")
    .mutation(async ({ ctx, input }) => {
      // Next free row: one below the lowest playground widget in the project.
      const last = await ctx.prisma.customGraph.findFirst({
        where: {
          projectId: input.projectId,
          kind: PLAYGROUND_SRCDOC_CHART_KIND,
        },
        orderBy: { gridRow: "desc" },
        select: { gridRow: true },
      });

      return await ctx.prisma.customGraph.create({
        data: {
          id: nanoid(),
          projectId: input.projectId,
          name: input.name,
          kind: PLAYGROUND_SRCDOC_CHART_KIND,
          graph: graphOf({ code: input.code, queries: input.queries }),
          ...(input.dashboardId ? { dashboardId: input.dashboardId } : {}),
          gridColumn: 0,
          gridRow: last ? last.gridRow + 1 : 0,
          colSpan: 1,
          rowSpan: 1,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        name: z.string().optional(),
        code: z.string(),
        queries: z.array(playgroundQuerySchema),
      }),
    )
    .permission("analytics:update")
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.customGraph.updateMany({
        where: {
          id: input.id,
          projectId: input.projectId,
          kind: PLAYGROUND_SRCDOC_CHART_KIND,
        },
        data: {
          graph: graphOf({ code: input.code, queries: input.queries }),
          ...(input.name === undefined ? {} : { name: input.name }),
        },
      });
      return { success: true };
    }),

  updateLayout: protectedProcedure
    .input(
      z
        .object({ projectId: z.string(), graphId: z.string() })
        .merge(layoutSchema),
    )
    .permission("analytics:update")
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.customGraph.updateMany({
        where: {
          id: input.graphId,
          projectId: input.projectId,
          kind: PLAYGROUND_SRCDOC_CHART_KIND,
        },
        data: {
          gridColumn: input.gridColumn,
          gridRow: input.gridRow,
          colSpan: input.colSpan,
          rowSpan: input.rowSpan,
        },
      });
      return { success: true };
    }),

  batchUpdateLayouts: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        layouts: z.array(z.object({ graphId: z.string() }).merge(layoutSchema)),
      }),
    )
    .permission("analytics:update")
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$transaction(
        input.layouts.map((layout) =>
          ctx.prisma.customGraph.updateMany({
            where: {
              id: layout.graphId,
              projectId: input.projectId,
              kind: PLAYGROUND_SRCDOC_CHART_KIND,
            },
            data: {
              gridColumn: layout.gridColumn,
              gridRow: layout.gridRow,
              colSpan: layout.colSpan,
              rowSpan: layout.rowSpan,
            },
          }),
        ),
      );
      return { success: true };
    }),

  assignDashboard: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        dashboardId: z.string(),
      }),
    )
    .permission("analytics:update")
    .mutation(async ({ ctx, input }) => {
      // Next free row on the TARGET dashboard across every kind, so the pinned
      // widget lands below existing cards instead of overlapping. gridRow is
      // shared between the playground grid and the dashboard grid (prototype
      // coupling, accepted).
      const last = await ctx.prisma.customGraph.findFirst({
        where: { projectId: input.projectId, dashboardId: input.dashboardId },
        orderBy: { gridRow: "desc" },
        select: { gridRow: true },
      });
      await ctx.prisma.customGraph.updateMany({
        where: {
          id: input.id,
          projectId: input.projectId,
          kind: PLAYGROUND_SRCDOC_CHART_KIND,
        },
        data: {
          dashboardId: input.dashboardId,
          gridColumn: 0,
          gridRow: last ? last.gridRow + 1 : 0,
          // colSpan/rowSpan intentionally untouched — keep the widget's size.
        },
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .permission("analytics:delete")
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.customGraph.deleteMany({
        where: {
          id: input.id,
          projectId: input.projectId,
          kind: PLAYGROUND_SRCDOC_CHART_KIND,
        },
      });
      return { success: true };
    }),
});
