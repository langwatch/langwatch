/**
 * The server half of `dashboardWidgets.*`: a permission and a handler per
 * procedure. The playground's rollout gate is the widget operations' own.
 * Every call names the member as viewer: blocks on boards they cannot see read as not found.
 */
import { DASHBOARD_SRCDOC_CHART_KIND, type DashboardWidget } from "@langwatch/analytics-contract";
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  DashboardApi,
  dashboardWidgetTrpc,
  type dashboardWidgetTrpcRowSchema,
} from "@langwatch/dashboard-contract";
import { toDate } from "@langwatch/time";
import type { z } from "zod";

/** The widget as main's tRPC answered it, its instants as dates. */
const wireWidget = ({ createdAt, updatedAt, definition, ...widget }: DashboardWidget) => ({
  ...widget,
  definition: { ...definition, queries: [...definition.queries] },
  createdAt: toDate(createdAt),
  updatedAt: toDate(updatedAt),
});

/** Main's `list` answered the stored chart rows, the definition under `graph`. */
const wireRow = (widget: DashboardWidget): z.infer<typeof dashboardWidgetTrpcRowSchema> => {
  const { definition, ...row } = wireWidget(widget);

  return { ...row, graph: definition, filters: null, kind: DASHBOARD_SRCDOC_CHART_KIND };
};

export const dashboardWidgetTrpcTransport: TrpcRouterDeclaration<
  DashboardApi,
  typeof dashboardWidgetTrpc
> = defineTrpcRouter(DashboardApi, dashboardWidgetTrpc)
  .procedure("list")
  .withPermission("analytics:view")
  .handle(async ({ app, input, actor }) =>
    (
      await app.listDashboardWidgets({ projectId: input.projectId, viewer: { userId: actor.id } })
    ).map(wireRow),
  )

  .procedure("create")
  .withPermission("analytics:create")
  .handle(async ({ app, input, actor }) =>
    wireWidget(
      await app.createDashboardWidget({
        projectId: input.projectId,
        viewer: { userId: actor.id },
        ...(input.dashboardId === undefined ? {} : { dashboardId: input.dashboardId }),
        name: input.name,
        code: input.code,
        queries: input.queries,
      }),
    ),
  )

  .procedure("update")
  .withPermission("analytics:update")
  .handle(async ({ app, input, actor }) => {
    await app.updateDashboardWidget({
      projectId: input.projectId,
      viewer: { userId: actor.id },
      id: input.id,
      ...(input.name === undefined ? {} : { name: input.name }),
      code: input.code,
      queries: input.queries,
    });

    return { success: true as const };
  })

  .procedure("updateLayout")
  .withPermission("analytics:update")
  .handle(
    async ({ app, actor, input: { projectId, graphId, gridColumn, gridRow, colSpan, rowSpan } }) =>
      app.updateDashboardWidgetLayout({
        projectId,
        graphId,
        viewer: { userId: actor.id },
        layout: { gridColumn, gridRow, colSpan, rowSpan },
      }),
  )

  .procedure("batchUpdateLayouts")
  .withPermission("analytics:update")
  .handle(async ({ app, input, actor }) =>
    app.batchUpdateDashboardWidgetLayouts({
      projectId: input.projectId,
      viewer: { userId: actor.id },
      layouts: input.layouts.map(({ graphId, gridColumn, gridRow, colSpan, rowSpan }) => ({
        graphId,
        layout: { gridColumn, gridRow, colSpan, rowSpan },
      })),
    }),
  )

  .procedure("assignDashboard")
  .withPermission("analytics:update")
  .handle(async ({ app, input, actor }) => {
    await app.assignDashboardWidgetToDashboard({
      projectId: input.projectId,
      viewer: { userId: actor.id },
      id: input.id,
      dashboardId: input.dashboardId,
    });

    return { success: true as const };
  })

  .procedure("delete")
  .withPermission("analytics:delete")
  .handle(async ({ app, input, actor }) => {
    await app.deleteDashboardWidget({
      projectId: input.projectId,
      id: input.id,
      viewer: { userId: actor.id },
    });

    return { success: true as const };
  })
  .build();
