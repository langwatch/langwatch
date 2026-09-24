/**
 * The server half of `dashboardWidgets.*`: a permission and a handler per
 * procedure. The playground's rollout gate is the widget operations' own.
 */
import { DASHBOARD_SRCDOC_CHART_KIND, type DashboardWidget } from "@langwatch/analytics-contract";
import { defineTrpcRouter } from "@langwatch/api/trpc";
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

export const dashboardWidgetTrpcTransport = defineTrpcRouter(DashboardApi, dashboardWidgetTrpc)
  .procedure("list")
  .withPermission("analytics:view")
  .handle(async ({ app, input }) =>
    (await app.listDashboardWidgets({ projectId: input.projectId })).map(wireRow),
  )

  .procedure("create")
  .withPermission("analytics:create")
  .handle(async ({ app, input }) =>
    wireWidget(
      await app.createDashboardWidget({
        projectId: input.projectId,
        ...(input.dashboardId === undefined ? {} : { dashboardId: input.dashboardId }),
        name: input.name,
        code: input.code,
        queries: input.queries,
      }),
    ),
  )

  .procedure("update")
  .withPermission("analytics:update")
  .handle(async ({ app, input }) => {
    await app.updateDashboardWidget({
      projectId: input.projectId,
      id: input.id,
      ...(input.name === undefined ? {} : { name: input.name }),
      code: input.code,
      queries: input.queries,
    });

    return { success: true as const };
  })

  .procedure("assignDashboard")
  .withPermission("analytics:update")
  .handle(async ({ app, input }) => {
    await app.assignDashboardWidgetToDashboard({
      projectId: input.projectId,
      id: input.id,
      dashboardId: input.dashboardId,
    });

    return { success: true as const };
  })
  .build();
