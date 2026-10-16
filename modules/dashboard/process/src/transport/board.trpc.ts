/**
 * The server half of `boards.*`, the Dashboards area's boards. Reading and starring take
 * `analytics:view`; creating `analytics:create`, editing and scope `analytics:update`, removing
 * `analytics:delete`. The service asks for a scope change's author.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { DashboardApi, boardTrpc } from "@langwatch/dashboard-contract";

export const boardTrpcTransport: TrpcRouterDeclaration<DashboardApi, typeof boardTrpc> =
  defineTrpcRouter(DashboardApi, boardTrpc)
    .procedure("getAll")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) => {
      const boards = await app.findBoards({
        projectId: input.projectId,
        viewer: { userId: actor.id },
        ...(input.includeOrganization === true ? { includeOrganization: true } : {}),
      });

      return boards.map(({ graphCount, ...board }) => ({
        ...board,
        _count: { graphs: graphCount },
      }));
    })

    .procedure("getById")
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.getBoard({
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        viewer: { userId: actor.id },
      }),
    )

    .procedure("create")
    .withPermission("analytics:create")
    .handle(async ({ app, input, actor }) =>
      app.createBoard({ projectId: input.projectId, name: input.name, createdById: actor.id }),
    )

    .procedure("update")
    .withPermission("analytics:update")
    .handle(async ({ app, input, actor }) =>
      app.updateBoard({
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        viewer: { userId: actor.id },
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
      }),
    )

    .procedure("delete")
    .withPermission("analytics:delete")
    .handle(async ({ app, input, actor }) =>
      app.deleteBoard({
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        viewer: { userId: actor.id },
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
      app.star({ projectId: input.projectId, userId: actor.id, star: input.star }),
    )

    .procedure("unstar")
    .refusedOnAggregate()
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.unstar({ projectId: input.projectId, userId: actor.id, star: input.star }),
    )

    .procedure("reorderStars")
    .refusedOnAggregate()
    .withPermission("analytics:view")
    .handle(async ({ app, input, actor }) =>
      app.reorderStars({ projectId: input.projectId, userId: actor.id, stars: input.stars }),
    )
    .build();
