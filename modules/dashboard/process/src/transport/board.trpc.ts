/**
 * The server half of `boards.*`, the Dashboards area's boards. Reading and starring take
 * `analytics:view`, a member's own sidebar order `organization:view`; creating
 * `analytics:create`, editing, scope and moving `analytics:update`, removing `analytics:delete`.
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

    // Asked of the organization, which every seat holds, Developer included (ADR-002); the
    // service then reads each project only where the member holds `analytics:view`.
    .procedure("listInOrganization")
    .withPermission("organization:view")
    .handle(async ({ app, input, actor }) =>
      app.findBoardsInOrganization({
        organizationId: input.organizationId,
        viewer: { userId: actor.id },
      }),
    )

    // The same door and loaded-row rule as the library, so an id answers only what it lists.
    .procedure("resolve")
    .withPermission("organization:view")
    .handle(async ({ app, input, actor }) =>
      app.getBoardInOrganization({
        organizationId: input.organizationId,
        viewer: { userId: actor.id },
        dashboardId: input.dashboardId,
      }),
    )

    // Asked of the organization like the library; the service keeps the projects the member
    // may create in, with Dashboards on.
    .procedure("storeProjects")
    .withPermission("organization:view")
    .handle(async ({ app, input, actor }) =>
      app.findStoreProjects({ organizationId: input.organizationId, viewer: { userId: actor.id } }),
    )

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
      app.createBoard({
        projectId: input.projectId,
        name: input.name,
        createdById: actor.id,
        ...(input.homeProduct === undefined ? {} : { homeProduct: input.homeProduct }),
      }),
    )

    // Making it and setting its scope, in one write: both grants, asked at the door.
    .procedure("createAtScope")
    .withPermission(["analytics:create", "analytics:update"])
    .handle(async ({ app, input, actor }) =>
      app.createBoard({
        projectId: input.projectId,
        name: input.name,
        createdById: actor.id,
        scope: input.scope,
        ...(input.homeProduct === undefined ? {} : { homeProduct: input.homeProduct }),
      }),
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

    // Asked in the owning project, as an edit is; the service applies the scope a move implies.
    .procedure("move")
    .withPermission("analytics:update")
    .handle(async ({ app, input, actor }) =>
      app.moveBoard({
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        homeProduct: input.homeProduct,
        viewer: { userId: actor.id },
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

    // The member's own sidebar, so the organization floor every seat holds is enough.
    .procedure("sidebarOrder")
    .withPermission("organization:view")
    .handle(async ({ app, input, actor }) =>
      app.getSidebarOrder({
        organizationId: input.organizationId,
        userId: actor.id,
        homeProduct: input.homeProduct,
      }),
    )

    .procedure("reorderSidebar")
    .withPermission("organization:view")
    .handle(async ({ app, input, actor }) =>
      app.setSidebarOrder({
        organizationId: input.organizationId,
        userId: actor.id,
        homeProduct: input.homeProduct,
        dashboardIds: input.dashboardIds,
      }),
    )
    .build();
