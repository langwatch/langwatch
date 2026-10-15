/**
 * The server half of `dashboards.*`. Reading takes `analytics:view`; creating
 * `analytics:create`, editing `analytics:update`, removing `analytics:delete`. Starring is
 * personal: `analytics:view`, naming the actor. Scope is an edit; the service asks for the author.
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
        ...(input.includeOrganization === true ? { includeOrganization: true } : {}),
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
    .handle(
      async ({ app, input, actor }) =>
        (
          await app.getOrCreateFirst({ projectId: input.projectId, viewer: { userId: actor.id } })
        )[0] ?? null,
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

    .procedure("setScope")
    .withPermission("analytics:update")
    .handle(async ({ app, input, actor }) =>
      app.setDashboardScope({
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        scope: input.scope,
        viewer: { userId: actor.id },
      }),
    )

    .procedure("scopeImpact")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.getDashboardScopeImpact({
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        viewer: { userId: actor.id },
      }),
    )

    .procedure("scopeProjects")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.listDashboardScopeProjects({
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        viewer: { userId: actor.id },
      }),
    )

    .procedure("listStarred")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.listStarred({ projectId: input.projectId, userId: actor.id }),
    )

    .procedure("star")
    .refusedOnAggregate()
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.star({
        projectId: input.projectId,
        userId: actor.id,
        star: input.star,
      }),
    )

    .procedure("unstar")
    .refusedOnAggregate()
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.unstar({
        projectId: input.projectId,
        userId: actor.id,
        star: input.star,
      }),
    )

    .procedure("reorderStars")
    .refusedOnAggregate()
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.reorderStars({
        projectId: input.projectId,
        userId: actor.id,
        stars: input.stars,
      }),
    )

    .procedure("sourcePresence")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.getSourcePresence({ projectId: input.projectId, viewer: { userId: actor.id } }),
    )
    .build();
