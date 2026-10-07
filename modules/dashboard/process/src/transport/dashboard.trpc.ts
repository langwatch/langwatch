/**
 * The server half of `dashboards.*`. Reading takes `analytics:view`; creating
 * `analytics:create`, editing `analytics:update`, removing `analytics:delete`.
 * Starring is personal, so it takes only `analytics:view` and names the actor.
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
    .handle(async ({ app, input, actor }) =>
      app.create({ projectId: input.projectId, name: input.name, createdById: actor.id }),
    )

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
    .handle(async ({ app, input, actor }) =>
      app.getOrCreateFirst({ projectId: input.projectId, viewer: { userId: actor.id } }),
    )

    .procedure("updateDetails")
    .withPermission("analytics:update")
    .handle(async ({ app, input, actor }) =>
      app.updateDashboardDetails({
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        viewer: { userId: actor.id },
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
      }),
    )

    .procedure("listStarred")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.listStarred({ projectId: input.projectId, userId: actor.id }),
    )

    .procedure("star")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.star({
        projectId: input.projectId,
        userId: actor.id,
        dashboardId: input.dashboardId,
      }),
    )

    .procedure("unstar")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.unstar({
        projectId: input.projectId,
        userId: actor.id,
        dashboardId: input.dashboardId,
      }),
    )

    .procedure("reorderStars")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.reorderStars({
        projectId: input.projectId,
        userId: actor.id,
        dashboardIds: input.dashboardIds,
      }),
    )

    .procedure("sourcePresence")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.getSourcePresence({ projectId: input.projectId, viewer: { userId: actor.id } }),
    )
    .build();
