/**
 * REST for a project's dashboards, under `/api/dashboards`. Every answer
 * carries the address a reader opens the dashboard at, which the application
 * builds from the project's slug and the deployment's base URL.
 */
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  dashboardDeletedResponseSchema,
  dashboardDetailResponseSchema,
  dashboardListResponseSchema,
  dashboardReorderResponseSchema,
  dashboardResponseSchema,
  dashboardRestNameSchema,
  dashboardRestParamsSchema,
  dashboardRestReorderSchema,
  DashboardApi,
  type Dashboard,
} from "@langwatch/dashboard-contract";

import { viewerOfActor } from "../rules/dashboard-viewer.rules.ts";

export const dashboardRest = defineRestRouter(DashboardApi)
  .withNamespace("dashboards")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/", "getApiDashboards")
  .withPermission("analytics:view")
  .withOutput(dashboardListResponseSchema)
  .withDocs({
    tags: ["Dashboards"],
    description: "List all dashboards for the project with graph counts",
  })
  .handle(async ({ app, scope, actor }) => {
    const dashboards = await app.getAll({
      projectId: scope.id,
      graphCountScope: "builder",
      ...viewerOfActor({ actor }),
    });
    const links = await app.getDashboardLinks({
      projectId: scope.id,
      dashboardIds: dashboards.map((dashboard) => dashboard.id),
    });

    return {
      data: dashboards.map((dashboard) => ({
        id: dashboard.id,
        name: dashboard.name,
        order: dashboard.order,
        graphCount: dashboard.graphCount,
        createdAt: dashboard.createdAt,
        updatedAt: dashboard.updatedAt,
        platformUrl: links[dashboard.id] ?? "",
      })),
    };
  })

  // Creating asks for `analytics:create`; `:manage` still implies it, so nobody
  // who could create a dashboard yesterday loses that.
  .post("/", "postApiDashboards")
  .withAudit("dashboards.create")
  .withInput(dashboardRestNameSchema)
  .withPermission("analytics:create")
  .withOutput(dashboardResponseSchema)
  .withStatus(201)
  .withDocs({ tags: ["Dashboards"], description: "Create a new dashboard" })
  .handle(async ({ app, input, scope, actor }) => {
    const { viewer } = viewerOfActor({ actor });
    const created = await app.create({
      projectId: scope.id,
      name: input.name,
      ...(viewer === undefined ? {} : { createdById: viewer.userId }),
    });

    return withLink(app, scope.id, created);
  })

  // Registered before /:id so "reorder" is not read as an id. Reordering
  // rewrites existing dashboards' positions — an `:update`.
  .put("/reorder", "putApiDashboardsReorder")
  .withAudit("dashboards.reorderDashboards")
  .withInput(dashboardRestReorderSchema)
  .withPermission("analytics:update")
  .withOutput(dashboardReorderResponseSchema)
  .withDocs({
    tags: ["Dashboards"],
    description: "Reorder dashboards by providing an ordered list of IDs",
  })
  .handle(async ({ app, input, scope, actor }) =>
    app.reorder({
      projectId: scope.id,
      dashboardIds: input.dashboardIds,
      ...viewerOfActor({ actor }),
    }),
  )

  .get("/:id", "getApiDashboardsById")
  .withParams(dashboardRestParamsSchema)
  .withPermission("analytics:view")
  .withOutput(dashboardDetailResponseSchema)
  .withDocs({
    tags: ["Dashboards"],
    description: "Get a dashboard by its id, including its graphs",
  })
  .handle(async ({ app, input, scope, actor }) => {
    const found = await app.getById({
      projectId: scope.id,
      dashboardId: input.id,
      ...viewerOfActor({ actor }),
    });

    return { ...(await withLink(app, scope.id, found)), graphs: found.graphs };
  })

  .patch("/:id", "patchApiDashboardsById")
  .withAudit("dashboards.rename")
  .withParams(dashboardRestParamsSchema)
  .withInput(dashboardRestNameSchema)
  .withPermission("analytics:update")
  .withOutput(dashboardResponseSchema)
  .withDocs({ tags: ["Dashboards"], description: "Rename a dashboard" })
  .handle(async ({ app, input, scope, actor }) => {
    const renamed = await app.rename({
      projectId: scope.id,
      dashboardId: input.id,
      name: input.name,
      ...viewerOfActor({ actor }),
    });

    return withLink(app, scope.id, renamed);
  })

  // Hard delete with cascade — deliberately stays at `:manage`.
  .delete("/:id", "deleteApiDashboardsById")
  .withAudit("dashboards.delete")
  .withParams(dashboardRestParamsSchema)
  .withPermission("analytics:manage")
  .withOutput(dashboardDeletedResponseSchema)
  .withDocs({
    tags: ["Dashboards"],
    description: "Delete a dashboard and its graphs (hard delete, cascade)",
  })
  .handle(async ({ app, input, scope, actor }) => {
    const deleted = await app.delete({
      projectId: scope.id,
      dashboardId: input.id,
      ...viewerOfActor({ actor }),
    });

    return { id: deleted.id, name: deleted.name };
  })
  .build();

/** One dashboard as this family answers it: the row plus where it opens. */
async function withLink(
  app: DashboardApi,
  projectId: string,
  dashboard: Pick<Dashboard, "id" | "name" | "order" | "createdAt" | "updatedAt">,
) {
  const links = await app.getDashboardLinks({ projectId, dashboardIds: [dashboard.id] });

  return {
    id: dashboard.id,
    name: dashboard.name,
    order: dashboard.order,
    createdAt: dashboard.createdAt,
    updatedAt: dashboard.updatedAt,
    platformUrl: links[dashboard.id] ?? "",
  };
}
