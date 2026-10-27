/**
 * The server half of `dashboards.*`, the Analytics Reports boards. Reading takes
 * `analytics:view`; creating `analytics:create`, editing `analytics:update`, removing
 * `analytics:delete`.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { DashboardApi, dashboardTrpc } from "@langwatch/dashboard-contract";

export const dashboardTrpcTransport: TrpcRouterDeclaration<DashboardApi, typeof dashboardTrpc> =
  defineTrpcRouter(DashboardApi, dashboardTrpc)
    .procedure("getAll")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) => {
      const dashboards = await app.getAll({
        projectId: input.projectId,
        graphCountScope: "builder",
        viewer: { userId: actor.id },
      });

      return dashboards.map(({ graphCount, ...dashboard }) => ({
        ...dashboard,
        _count: { graphs: graphCount },
      }));
    })

    .procedure("getById")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.getById({
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        viewer: { userId: actor.id },
      }),
    )

    .procedure("create")
    .withPermission("analytics:create")
    .handle(async ({ app, input }) => app.create({ projectId: input.projectId, name: input.name }))

    .procedure("rename")
    .withPermission("analytics:update")
    .handle(async ({ app, input, actor }) =>
      app.rename({
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        name: input.name,
        viewer: { userId: actor.id },
      }),
    )

    .procedure("delete")
    .withPermission("analytics:delete")
    .handle(async ({ app, input, actor }) =>
      app.delete({
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        viewer: { userId: actor.id },
      }),
    )

    .procedure("reorderDashboards")
    .withPermission("analytics:update")
    .handle(async ({ app, input, actor }) =>
      app.reorder({
        projectId: input.projectId,
        dashboardIds: input.dashboardIds,
        viewer: { userId: actor.id },
      }),
    )

    .procedure("getOrCreateFirst")
    .withPermission("analytics:view")
    .handle(
      async ({ app, input, actor }) =>
        (
          await app.getOrCreateFirst({ projectId: input.projectId, viewer: { userId: actor.id } })
        )[0] ?? null,
    )

    .procedure("sourcePresence")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.getSourcePresence({ projectId: input.projectId, viewer: { userId: actor.id } }),
    )
    .build();
