import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { allocateNextGridRow } from "~/server/analytics/allocateNextGridRow";
import {
  BUILDER_CHART_KIND,
  WORKBENCH_SQL_CHART_KIND,
} from "~/server/analytics/chartKinds";
import { dashboardBelongsToProject } from "~/server/analytics/dashboardBelongsToProject";
import { placeableKindFilter } from "~/server/analytics/placeableKindFilter";
import { redactActionParamsFor } from "~/server/app-layer/automations/providers/registry";
import { type FilterField, filterFieldsEnum } from "../../filters/types";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Read-side hydration shape for the `Add / Edit alert` bell icon on the
 * graph card header (GraphCardHeader.tsx). Writes go through the
 * automations router (`automation.upsert`) as of ADR-034 Phase 5.2;
 * this router only reads the persisted graph-alert Trigger row.
 */
interface AlertActionParams {
  members?: string[];
  slackWebhook?: string;
  seriesName?: string;
}

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
    .permission("analytics:create")
    .mutation(async ({ ctx, input }) => {
      const graph = JSON.parse(input.graph);

      if (
        input.dashboardId &&
        !(await dashboardBelongsToProject(
          ctx.prisma,
          input.dashboardId,
          input.projectId,
        ))
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dashboard not found",
        });
      }

      // If no gridRow provided, find the next available row. Shared with
      // `placeChart` so the two writers that can put a chart on this grid
      // never disagree about which row is free.
      let gridRow = input.gridRow;
      if (gridRow === undefined && input.dashboardId) {
        gridRow = await allocateNextGridRow(ctx.prisma, {
          dashboardId: input.dashboardId,
          projectId: input.projectId,
        });
      }

      const customGraph = await ctx.prisma.customGraph.create({
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

      // Alert-writing lives on `automation.upsert` with `customGraphId`
      // as of ADR-034 Phase 5.2. The dashboard chart's `Add alert` bell
      // opens the automations drawer; this router no longer accepts an
      // `alert` field.

      return customGraph;
    }),
  getAll: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dashboardId: z.string().optional(),
      }),
    )
    .permission("analytics:view")
    .query(async ({ input, ctx }) => {
      const { projectId, dashboardId } = input;
      const prisma = ctx.prisma;

      // Placed workbench charts join the grid, but only when reading one
      // dashboard. The unscoped read (`dashboardId` absent) is the chart
      // *picker* the builder offers, and a saved workbench chart is not
      // something a builder graph can be composed from — including them there
      // would offer a member a chart the builder cannot open.
      //
      // Gated on the workbench flag so a deployment with the feature off sees
      // exactly the grid it saw before, even if rows exist from a trial —
      // the same gate every placement mutation below applies, so what the
      // grid shows and what a card action may touch cannot disagree.
      const placeable = dashboardId
        ? await placeableKindFilter({ prisma, projectId })
        : { kind: BUILDER_CHART_KIND };

      const graphs = await prisma.customGraph.findMany({
        where: {
          projectId,
          ...placeable,
          ...(dashboardId ? { dashboardId } : {}),
        },
        orderBy: dashboardId
          ? [{ gridRow: "asc" }, { gridColumn: "asc" }]
          : { createdAt: "desc" },
        include: {
          trigger: true,
        },
      });

      // A workbench row's `graph` column is its definition — `{ sql,
      // parameters, vegaLiteSpec }`. The grid does not draw from it: the
      // widget reads its own chart through the saved-chart service, which
      // parses the versioned schema and refuses a row this build cannot read.
      // Sending it here too would put a member's stored SQL in the dashboard
      // payload for no one to use.
      const withoutWorkbenchDefinitions = graphs.map((graph) =>
        graph.kind === WORKBENCH_SQL_CHART_KIND
          ? { ...graph, graph: null }
          : graph,
      );

      // The included trigger row carries provider secrets in actionParams
      // (the encrypted Slack bot token per ADR-041, webhook header values
      // per ADR-040 §3) — strip them per the trigger's own action before the
      // rows leave the server, the same registry-driven redaction the
      // automations router applies on its read paths.
      return withoutWorkbenchDefinitions.map((graph) =>
        graph.trigger
          ? {
              ...graph,
              trigger: {
                ...graph.trigger,
                actionParams: redactActionParamsFor(
                  graph.trigger.action,
                  graph.trigger.actionParams ?? {},
                ),
              },
            }
          : graph,
      );
    }),
  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .permission("analytics:delete")
    .mutation(async ({ ctx, input }) => {
      const { id } = input;
      const prisma = ctx.prisma;

      // Removing a card removes the row, whichever kind it is — a member who
      // deletes a workbench widget from a dashboard means the widget, and
      // leaving the row behind would strand a chart on no dashboard. Scoped by
      // the same flag the read is: with the workbench off a `workbench_sql`
      // row is not on this grid, so deleting one by id answers not-found.
      const placeable = await placeableKindFilter({
        prisma,
        projectId: input.projectId,
      });

      const graph = await prisma.customGraph.findUnique({
        where: { id, projectId: input.projectId, ...placeable },
      });
      if (!graph) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Graph not found" });
      }

      await prisma.customGraph.delete({
        where: { id, projectId: input.projectId, ...placeable },
      });

      return graph;
    }),
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .permission("analytics:view")
    .query(async ({ ctx, input }) => {
      const { id } = input;
      const prisma = ctx.prisma;

      const graph = await prisma.customGraph.findUnique({
        where: { id, projectId: input.projectId, kind: BUILDER_CHART_KIND },
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

      // Find associated trigger for custom graph alert using direct relation
      const trigger = await prisma.trigger.findUnique({
        where: {
          customGraphId: id,
          projectId: input.projectId,
        },
      });

      let alertData = undefined;
      if (trigger?.active && !trigger.deleted) {
        const actionParams =
          trigger.actionParams as unknown as AlertActionParams & {
            threshold: number;
            operator: string;
            timePeriod: number;
          };
        alertData = {
          enabled: true,
          threshold: actionParams.threshold,
          operator: actionParams.operator,
          timePeriod: actionParams.timePeriod,
          seriesName: actionParams.seriesName || "",
          type: trigger.alertType,
          action: trigger.action,
          actionParams: {
            members: actionParams.members,
            slackWebhook: actionParams.slackWebhook,
            seriesName: actionParams.seriesName,
          },
          triggerId: trigger.id,
        };
      }

      return {
        ...graph,
        filters: validatedFilters,
        alert: alertData,
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
    .permission("analytics:update")
    .mutation(async ({ ctx, input }) => {
      const prisma = ctx.prisma;

      const customGraph = await prisma.customGraph.update({
        where: {
          id: input.graphId,
          projectId: input.projectId,
          kind: BUILDER_CHART_KIND,
        },
        data: {
          name: input.name,
          graph: JSON.parse(input.graph),
          filters: input.filterParams?.filters ?? {},
        },
      });

      // Alert-writing lives on `automation.upsert` with `customGraphId`
      // as of ADR-034 Phase 5.2. The bell icon in the chart-card header
      // opens the automations drawer for edit; this router no longer
      // accepts an `alert` field.

      return customGraph;
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
    .permission("analytics:update")
    .mutation(async ({ ctx, input }) => {
      // Placement, not definition: where a card sits on the grid is a fact
      // about the dashboard rather than about the chart's shape, so both kinds
      // are movable — while the workbench is on for this project. The
      // kind-scoped reads that matter are the ones that *interpret* `graph` —
      // `getById` and `update` below — and they stay builder-only.
      const placeable = await placeableKindFilter({
        prisma: ctx.prisma,
        projectId: input.projectId,
      });

      return ctx.prisma.customGraph.update({
        where: {
          id: input.graphId,
          projectId: input.projectId,
          ...placeable,
        },
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
    .permission("analytics:update")
    .mutation(async ({ ctx, input }) => {
      const placeable = await placeableKindFilter({
        prisma: ctx.prisma,
        projectId: input.projectId,
      });

      const updates = input.layouts.map((layout) =>
        ctx.prisma.customGraph.update({
          where: {
            id: layout.graphId,
            projectId: input.projectId,
            ...placeable,
          },
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
