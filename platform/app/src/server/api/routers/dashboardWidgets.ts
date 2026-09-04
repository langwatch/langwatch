/**
 * Persistence for dashboard widgets.
 *
 * A thin, project-scoped CRUD router over `CustomGraph` rows of kind
 * {@link DASHBOARD_SRCDOC_CHART_KIND}. Every read and write filters by that
 * kind alongside `projectId`, so a dashboard widget is never read, updated or
 * deleted through the builder or workbench paths — and neither of those ever
 * sees one of its rows. The `graph` column holds a
 * {@link DashboardWidgetDefinition} — see that module for the shape and why
 * it is versioned.
 *
 * Deliberately independent of `graphs.ts`: the playground stores a sandboxed
 * author file plus the named queries it runs, not a builder payload or a
 * validated workbench definition, so it borrows the grid columns and nothing
 * else.
 */

import { z } from "zod";

import type { Prisma } from "~/generated/prisma/client";
import {
  chartGridPlacementSchema,
  fitsChartGridWidth,
} from "~/server/analytics/chartGrid";
import { DASHBOARD_SRCDOC_CHART_KIND } from "~/server/analytics/chartKinds";
import { DashboardWidgetService } from "~/server/analytics/dashboard-widgets/dashboardWidget.service";
import {
  DASHBOARD_WIDGET_DEFINITION_VERSION,
  type DashboardWidgetDefinition,
  dashboardWidgetQuerySchema,
} from "~/server/analytics/dashboardWidgetDefinition";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { enforceCustomChartPlaygroundEnabled } from "./dashboardWidgetAccessMiddleware";

// A card's column and span pass their own bounds and still overflow the grid
// together; refused here rather than clipped by the grid that reads it.
const layoutSchema = chartGridPlacementSchema.refine(fitsChartGridWidth, {
  message: "gridColumn + colSpan must not exceed the grid's columns",
  path: ["colSpan"],
});

const graphOf = (input: {
  code: string;
  queries: DashboardWidgetDefinition["queries"];
}): Prisma.InputJsonValue => ({
  version: DASHBOARD_WIDGET_DEFINITION_VERSION,
  code: input.code,
  queries: input.queries,
});

export const dashboardWidgetsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("analytics:view")
    .use(enforceCustomChartPlaygroundEnabled)
    .query(async ({ ctx, input }) => {
      return await ctx.prisma.customGraph.findMany({
        where: {
          projectId: input.projectId,
          kind: DASHBOARD_SRCDOC_CHART_KIND,
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
        queries: z.array(dashboardWidgetQuerySchema),
      }),
    )
    .permission("analytics:create")
    .use(enforceCustomChartPlaygroundEnabled)
    .mutation(async ({ ctx, input }) => {
      // Through the service so the row scan and write are one atomic
      // transaction, the scan is scoped to the placement target, and a
      // `dashboardId` from another project is refused before it is persisted.
      return await DashboardWidgetService.create(ctx.prisma).createWidget({
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        input: { name: input.name, code: input.code, queries: input.queries },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        name: z.string().optional(),
        code: z.string(),
        queries: z.array(dashboardWidgetQuerySchema),
      }),
    )
    .permission("analytics:update")
    .use(enforceCustomChartPlaygroundEnabled)
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.customGraph.updateMany({
        where: {
          id: input.id,
          projectId: input.projectId,
          kind: DASHBOARD_SRCDOC_CHART_KIND,
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
      chartGridPlacementSchema
        .extend({ projectId: z.string(), graphId: z.string() })
        .refine(fitsChartGridWidth, {
          message: "gridColumn + colSpan must not exceed the grid's columns",
          path: ["colSpan"],
        }),
    )
    .permission("analytics:update")
    .use(enforceCustomChartPlaygroundEnabled)
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.customGraph.updateMany({
        where: {
          id: input.graphId,
          projectId: input.projectId,
          kind: DASHBOARD_SRCDOC_CHART_KIND,
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
        layouts: z.array(z.object({ graphId: z.string() }).and(layoutSchema)),
      }),
    )
    .permission("analytics:update")
    .use(enforceCustomChartPlaygroundEnabled)
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$transaction(
        input.layouts.map((layout) =>
          ctx.prisma.customGraph.updateMany({
            where: {
              id: layout.graphId,
              projectId: input.projectId,
              kind: DASHBOARD_SRCDOC_CHART_KIND,
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
    .use(enforceCustomChartPlaygroundEnabled)
    .mutation(async ({ ctx, input }) => {
      await DashboardWidgetService.create(ctx.prisma).assignToDashboard({
        id: input.id,
        projectId: input.projectId,
        dashboardId: input.dashboardId,
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .permission("analytics:delete")
    .use(enforceCustomChartPlaygroundEnabled)
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.customGraph.deleteMany({
        where: {
          id: input.id,
          projectId: input.projectId,
          kind: DASHBOARD_SRCDOC_CHART_KIND,
        },
      });
      return { success: true };
    }),
});
