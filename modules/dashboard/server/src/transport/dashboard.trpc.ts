/**
 * The server half of `dashboards.*`: a permission and a handler per procedure
 * the contract already named.
 *
 * Reading takes `analytics:view`; creating takes `analytics:create`, editing
 * `analytics:update`, and removing `analytics:delete`.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { DashboardApi, dashboardTrpc } from "@langwatch/dashboard-contract";

export const dashboardTrpcTransport = defineTrpcRouter(DashboardApi, dashboardTrpc)
  .procedure("getAll")
  .withPermission("analytics:view")
  .handle(async ({ app, input }) => {
    const dashboards = await app.getAll({
      projectId: input.projectId,
      graphCountScope: "builder",
    });

    return dashboards.map(({ graphCount, ...dashboard }) => ({
      ...dashboard,
      _count: { graphs: graphCount },
    }));
  })

  .procedure("getById")
  .withPermission("analytics:view")
  .handle(async ({ app, input }) =>
    app.getById({ projectId: input.projectId, dashboardId: input.dashboardId }),
  )

  .procedure("create")
  .withPermission("analytics:create")
  .handle(async ({ app, input }) => app.create({ projectId: input.projectId, name: input.name }))

  .procedure("rename")
  .withPermission("analytics:update")
  .handle(async ({ app, input }) =>
    app.rename({
      projectId: input.projectId,
      dashboardId: input.dashboardId,
      name: input.name,
    }),
  )

  .procedure("delete")
  .withPermission("analytics:delete")
  .handle(async ({ app, input }) =>
    app.delete({ projectId: input.projectId, dashboardId: input.dashboardId }),
  )

  .procedure("reorderDashboards")
  .withPermission("analytics:update")
  .handle(async ({ app, input }) =>
    app.reorder({ projectId: input.projectId, dashboardIds: input.dashboardIds }),
  )

  .procedure("getOrCreateFirst")
  .withPermission("analytics:view")
  .handle(async ({ app, input }) => app.getOrCreateFirst({ projectId: input.projectId }))
  .build();
