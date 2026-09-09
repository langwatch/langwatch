/**
 * The server half of `graphs.*`: a permission and a handler per procedure the
 * contract already named. The alert a card's bell renders arrives from the
 * application with its provider secrets already stripped.
 */
import { filterFieldsEnum } from "@langwatch/analytics-contract";
import { defineTrpcRouter } from "@langwatch/api/trpc";
import type { Trigger } from "@langwatch/automation-contract";
import {
  DashboardApi,
  graphTrpc,
  type Graph,
  type GraphAlert,
} from "@langwatch/dashboard-contract";

/** Compatibility shape: the old Prisma transport exposed the discriminator. */
const legacyGraph = <T extends Graph>(graph: T) => ({ ...graph, kind: "builder" as const });

/** Read-side hydration shape for the alert bell on the graph card header. */
type AlertActionParams = {
  members?: string[];
  seriesName?: string;
  threshold: number;
  operator: string;
  timePeriod: number;
};

export const graphTrpcTransport = defineTrpcRouter(DashboardApi, graphTrpc)
  .procedure("create")
  .withPermission("analytics:create")
  .handle(async ({ app, input }) =>
    legacyGraph(
      await app.createGraph({
        projectId: input.projectId,
        name: input.name,
        graph: JSON.parse(input.graph) as Record<string, unknown>,
        filters: input.filterParams?.filters ?? {},
        ...(input.dashboardId === undefined ? {} : { dashboardId: input.dashboardId }),
        layout: {
          gridColumn: input.gridColumn ?? 0,
          ...(input.gridRow === undefined ? {} : { gridRow: input.gridRow }),
          colSpan: input.colSpan ?? 1,
          rowSpan: input.rowSpan ?? 1,
        },
      }),
    ),
  )

  .procedure("getAll")
  .withPermission("analytics:view")
  .handle(async ({ app, input }) => {
    const { projectId, dashboardId } = input;
    const graphs = await app.listGraphs({
      projectId,
      ...(dashboardId === undefined ? {} : { dashboardId }),
    });

    const triggers = await app.getAlertsForGraphs({
      projectId,
      customGraphIds: graphs.map((graph) => graph.id),
    });
    const triggerByGraphId = new Map(
      triggers.flatMap((trigger) =>
        trigger.customGraphId === null ? [] : [[trigger.customGraphId, trigger] as const],
      ),
    );

    return graphs.map((graph) => ({
      ...legacyGraph(graph),
      trigger: triggerByGraphId.get(graph.id) ?? null,
    }));
  })

  .procedure("delete")
  .withPermission("analytics:delete")
  .handle(async ({ app, input }) =>
    legacyGraph(await app.deleteGraph({ projectId: input.projectId, graphId: input.id })),
  )

  .procedure("getById")
  .withPermission("analytics:view")
  .handle(async ({ app, input }) => {
    const graph = await app.getGraph({ projectId: input.projectId, graphId: input.id });

    const trigger = await app.findAlertForGraph({
      customGraphId: input.id,
      projectId: input.projectId,
    });

    return {
      ...legacyGraph(graph),
      filters: knownFilters(graph.filters),
      alert: trigger === undefined ? undefined : alertOf(trigger),
    };
  })

  .procedure("updateById")
  .withPermission("analytics:update")
  .handle(async ({ app, input }) =>
    legacyGraph(
      await app.updateGraph({
        projectId: input.projectId,
        graphId: input.graphId,
        name: input.name,
        graph: JSON.parse(input.graph) as Record<string, unknown>,
        filters: input.filterParams?.filters ?? {},
      }),
    ),
  )

  .procedure("updateLayout")
  .withPermission("analytics:update")
  .handle(async ({ app, input }) =>
    legacyGraph(
      await app.updateGraphLayout({
        projectId: input.projectId,
        graphId: input.graphId,
        layout: {
          gridColumn: input.gridColumn,
          gridRow: input.gridRow,
          colSpan: input.colSpan,
          rowSpan: input.rowSpan,
        },
      }),
    ),
  )

  .procedure("batchUpdateLayouts")
  .withPermission("analytics:update")
  .handle(async ({ app, input }) =>
    app.batchUpdateGraphLayouts({
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
    }),
  )
  .build();

/**
 * The alert bell on a card header. The parameters are the ones the application
 * allowed out: a threshold and a period are shown, the provider's own secrets
 * are already gone.
 */
function alertOf(trigger: Trigger): GraphAlert {
  const parameters = trigger.actionParams as AlertActionParams;

  return {
    enabled: true as const,
    threshold: parameters.threshold,
    operator: parameters.operator,
    timePeriod: parameters.timePeriod,
    seriesName: parameters.seriesName || "",
    type: trigger.alertType,
    action: trigger.action,
    actionParams: { members: parameters.members, seriesName: parameters.seriesName },
    triggerId: trigger.id,
  };
}

/**
 * The filters a stored graph names that this deployment still offers: a graph
 * saved against a field the registry has since dropped is read back without
 * it.
 */
function knownFilters(
  filters: Graph["filters"],
): Record<string, string[] | Record<string, string[]>> | undefined {
  if (!filters || typeof filters !== "object") return undefined;

  const known: Record<string, string[] | Record<string, string[]>> = {};
  for (const [key, value] of Object.entries(filters)) {
    const usable = Array.isArray(value) || (typeof value === "object" && value !== null);
    if (filterFieldsEnum.safeParse(key).success && usable) {
      known[key] = value as string[] | Record<string, string[]>;
    }
  }

  return Object.keys(known).length > 0 ? known : undefined;
}
