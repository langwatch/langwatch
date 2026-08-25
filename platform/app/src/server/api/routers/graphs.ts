import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Graph } from "@langwatch/dashboard-contract";
import { redactActionParamsFor } from "~/server/app-layer/automations/providers/registry";
import { type FilterField, filterFieldsEnum } from "../../filters/types";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/** Compatibility shape: the old Prisma transport exposed the discriminator. */
const legacyGraph = <T extends Graph>(graph: T) => ({
  ...graph,
  kind: "builder" as const,
});

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

      let customGraph;
      try {
        customGraph = await ctx.app.dashboard.createGraph({
          projectId: input.projectId,
          name: input.name,
          graph,
          filters: input.filterParams?.filters ?? {},
          ...(input.dashboardId === undefined ? {} : { dashboardId: input.dashboardId }),
          layout: {
            gridColumn: input.gridColumn ?? 0,
            ...(input.gridRow === undefined ? {} : { gridRow: input.gridRow }),
            colSpan: input.colSpan ?? 1,
            rowSpan: input.rowSpan ?? 1,
          },
        });
      } catch (error) {
        if (error instanceof Error && error.name === "DashboardNotFoundError") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Dashboard not found" });
        }
        throw error;
      }

      // Alert-writing lives on `automation.upsert` with `customGraphId`
      // as of ADR-034 Phase 5.2. The dashboard chart's `Add alert` bell
      // opens the automations drawer; this router no longer accepts an
      // `alert` field.

      return legacyGraph(customGraph);
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
      const graphs = await ctx.app.dashboard.listGraphs({
        projectId,
        ...(dashboardId === undefined ? {} : { dashboardId }),
      });

      const triggers = await ctx.app.automation.getByCustomGraphIds({
        projectId,
        customGraphIds: graphs.map((graph) => graph.id),
      });
      const triggerByGraphId = new Map(
        triggers.flatMap((trigger) =>
          trigger.customGraphId === null
            ? []
            : [[trigger.customGraphId, trigger] as const],
        ),
      );

      // The included trigger row carries provider secrets in actionParams
      // (the encrypted Slack bot token per ADR-041, webhook header values
      // per ADR-040 §3) — strip them per the trigger's own action before the
      // rows leave the server, the same registry-driven redaction the
      // automations router applies on its read paths.
      return graphs.map((graph: Graph) => {
          const trigger = triggerByGraphId.get(graph.id) ?? null;
          return {
            ...legacyGraph(graph),
            trigger: trigger
              ? {
                  ...trigger,
                  actionParams: redactActionParamsFor(
                    trigger.action,
                    trigger.actionParams ?? {},
                  ),
                }
              : null,
          };
        });
    }),
  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .permission("analytics:delete")
    .mutation(async ({ ctx, input }) => {
      const { id } = input;
      try {
        return legacyGraph(await ctx.app.dashboard.deleteGraph({
          projectId: input.projectId,
          graphId: id,
        }));
      } catch (error) {
        if (error instanceof Error && error.name === "GraphNotFoundError") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Graph not found" });
        }
        throw error;
      }
    }),
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .permission("analytics:view")
    .query(async ({ ctx, input }) => {
      const { id } = input;
      let graph;
      try {
        graph = await ctx.app.dashboard.getGraph({
          projectId: input.projectId,
          graphId: id,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "GraphNotFoundError") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Graph not found" });
        }
        throw error;
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
      const trigger = await ctx.app.automation.tryGetByCustomGraphId({
        customGraphId: id,
        projectId: input.projectId,
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
        ...legacyGraph(graph),
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
      let customGraph;
      try {
        customGraph = await ctx.app.dashboard.updateGraph({
          projectId: input.projectId,
          graphId: input.graphId,
          name: input.name,
          graph: JSON.parse(input.graph),
          filters: input.filterParams?.filters ?? {},
        });
      } catch (error) {
        if (error instanceof Error && error.name === "GraphNotFoundError") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Graph not found" });
        }
        throw error;
      }

      // Alert-writing lives on `automation.upsert` with `customGraphId`
      // as of ADR-034 Phase 5.2. The bell icon in the chart-card header
      // opens the automations drawer for edit; this router no longer
      // accepts an `alert` field.

      return legacyGraph(customGraph);
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
      try {
        return legacyGraph(await ctx.app.dashboard.updateGraphLayout({
          projectId: input.projectId,
          graphId: input.graphId,
          layout: {
            gridColumn: input.gridColumn,
            gridRow: input.gridRow,
            colSpan: input.colSpan,
            rowSpan: input.rowSpan,
          },
        }));
      } catch (error) {
        if (error instanceof Error && error.name === "GraphNotFoundError") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Graph not found" });
        }
        throw error;
      }
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
      try {
        return await ctx.app.dashboard.batchUpdateGraphLayouts({
          projectId: input.projectId,
          layouts: input.layouts.map((layout) => ({
            graphId: layout.graphId,
            layout: {
              gridColumn: layout.gridColumn,
              gridRow: layout.gridRow,
              colSpan: layout.colSpan,
              rowSpan: layout.rowSpan,
            },
          })),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "GraphNotFoundError") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Graph not found" });
        }
        throw error;
      }
    }),
});
