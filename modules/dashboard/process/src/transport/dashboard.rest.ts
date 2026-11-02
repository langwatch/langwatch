/**
 * REST for a project's Analytics Reports dashboards, under `/api/v1/analytics/reports`, deprecated
 * in favour of the Dashboards API at `/api/v1/dashboards` (dashboards-v2.feature AC199r).
 */
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  nameUnlessMissing,
  type RestSharedPath,
} from "@langwatch/api/rest";
import {
  dashboardDeletedResponseSchema,
  dashboardDetailResponseSchema,
  dashboardListResponseSchema,
  dashboardReorderResponseSchema,
  dashboardResponseSchema,
  dashboardRestNameSchema,
  dashboardRestReorderSchema,
  DashboardApi,
  DashboardNotFoundError,
  reportRestParamsSchema,
  type Dashboard,
  type DashboardViewer,
} from "@langwatch/dashboard-contract";

import { viewerOfActor, viewerOfOwner } from "../rules/dashboard-viewer.rules.ts";

/** The Reports boards stay in analytics' namespace for good, beside its timeseries query. */
const ANALYTICS_REPORTS: RestSharedPath = {
  owner: "analytics",
  reason: "dashboard serves the Analytics Reports boards under the analytics path",
  permanent: true,
};

const REPORT_TAGS = ["Analytics / Reports"];

/** Who a Reports call reads and writes as, beside the project. */
type ReportCall = Readonly<{ app: DashboardApi; projectId: string; viewer?: DashboardViewer }>;

/** What the Reports boards answer. */
const reportOperations = {
  async list({ app, projectId, viewer }: ReportCall) {
    const dashboards = await app.getAll({
      projectId,
      graphCountScope: "builder",
      ...(viewer ? { viewer } : {}),
    });
    const links = await app.getDashboardLinks({
      projectId,
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
  },

  async create({ app, projectId, name }: ReportCall & Readonly<{ name: string }>) {
    return withLink({ app, projectId, dashboard: await app.create({ projectId, name }) });
  },

  reorder({
    app,
    projectId,
    viewer,
    dashboardIds,
  }: ReportCall & Readonly<{ dashboardIds: string[] }>) {
    return app.reorder({ projectId, dashboardIds, ...(viewer ? { viewer } : {}) });
  },

  async read({
    app,
    projectId,
    viewer,
    dashboardId,
  }: ReportCall & Readonly<{ dashboardId: string }>) {
    const found = await app.getById({ projectId, dashboardId, ...(viewer ? { viewer } : {}) });

    return { ...(await withLink({ app, projectId, dashboard: found })), graphs: found.graphs };
  },

  async rename({
    app,
    projectId,
    viewer,
    dashboardId,
    name,
  }: ReportCall & Readonly<{ dashboardId: string; name: string }>) {
    const renamed = await app.rename({
      projectId,
      dashboardId,
      name,
      ...(viewer ? { viewer } : {}),
    });

    return withLink({ app, projectId, dashboard: renamed });
  },

  async delete({
    app,
    projectId,
    viewer,
    dashboardId,
  }: ReportCall & Readonly<{ dashboardId: string }>) {
    const deleted = await app.delete({ projectId, dashboardId, ...(viewer ? { viewer } : {}) });

    return { id: deleted.id, name: deleted.name };
  },

  /** The name a Langy key's delete card shows, read as the key's owner. */
  nameForDelete({
    app,
    projectId,
    id,
    ownerUserId,
  }: Readonly<{ app: DashboardApi; projectId: string; id: string; ownerUserId: string | null }>) {
    return nameUnlessMissing({
      read: app.getById({ projectId, dashboardId: id, ...viewerOfOwner({ ownerUserId }) }),
      missing: DashboardNotFoundError,
      nameOf: (dashboard) => dashboard.name,
    });
  },
};

export const dashboardRest = defineRestRouter(DashboardApi)
  .withNamespace("analytics-reports")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withDeprecated({
    successor: "/api/v1/dashboards",
    notice:
      "The Analytics Reports dashboards API is deprecated; use the Dashboards API at /api/v1/dashboards",
  })

  .get("/api/v1/analytics/reports", "getApiV1AnalyticsReports")
  .withSharedPath(ANALYTICS_REPORTS)
  .withPermission("analytics:view")
  .withOutput(dashboardListResponseSchema)
  .withDocs({
    tags: REPORT_TAGS,
    description: "List all dashboards for the project with graph counts",
  })
  .handle(({ app, scope, actor }) =>
    reportOperations.list({ app, projectId: scope.id, ...viewerOfActor({ actor }) }),
  )

  // Creating asks for `analytics:create`; `:manage` still implies it, so nobody
  // who could create a dashboard yesterday loses that.
  .post("/api/v1/analytics/reports", "postApiV1AnalyticsReports")
  .withSharedPath(ANALYTICS_REPORTS)
  .keepsRecords()
  .withAudit("dashboards.create")
  .withInput(dashboardRestNameSchema)
  .withPermission("analytics:create")
  .withOutput(dashboardResponseSchema)
  .withStatus(201)
  .withDocs({ tags: REPORT_TAGS, description: "Create a new dashboard" })
  .handle(({ app, input, scope }) =>
    reportOperations.create({ app, projectId: scope.id, name: input.name }),
  )

  // Registered before /:reportId so "reorder" is not read as an id. Reordering
  // rewrites existing dashboards' positions — an `:update`.
  .put("/api/v1/analytics/reports/reorder", "putApiV1AnalyticsReportsReorder")
  .withSharedPath(ANALYTICS_REPORTS)
  .keepsRecords()
  .withAudit("dashboards.reorderDashboards")
  .withInput(dashboardRestReorderSchema)
  .withPermission("analytics:update")
  .withOutput(dashboardReorderResponseSchema)
  .withDocs({
    tags: REPORT_TAGS,
    description: "Reorder dashboards by providing an ordered list of IDs",
  })
  .handle(({ app, input, scope, actor }) =>
    reportOperations.reorder({
      app,
      projectId: scope.id,
      dashboardIds: input.dashboardIds,
      ...viewerOfActor({ actor }),
    }),
  )

  .get("/api/v1/analytics/reports/:reportId", "getApiV1AnalyticsReportsByReportId")
  .withSharedPath(ANALYTICS_REPORTS)
  .withParams(reportRestParamsSchema)
  .withPermission("analytics:view")
  .withOutput(dashboardDetailResponseSchema)
  .withDocs({
    tags: REPORT_TAGS,
    description: "Get a dashboard by its id, including its graphs",
  })
  .handle(({ app, input, scope, actor }) =>
    reportOperations.read({
      app,
      projectId: scope.id,
      dashboardId: input.reportId,
      ...viewerOfActor({ actor }),
    }),
  )

  .patch("/api/v1/analytics/reports/:reportId", "patchApiV1AnalyticsReportsByReportId")
  .withSharedPath(ANALYTICS_REPORTS)
  .keepsRecords()
  .withAudit("dashboards.rename")
  .withParams(reportRestParamsSchema)
  .withInput(dashboardRestNameSchema)
  .withPermission("analytics:update")
  .withOutput(dashboardResponseSchema)
  .withDocs({ tags: REPORT_TAGS, description: "Rename a dashboard" })
  .handle(({ app, input, scope, actor }) =>
    reportOperations.rename({
      app,
      projectId: scope.id,
      dashboardId: input.reportId,
      name: input.name,
      ...viewerOfActor({ actor }),
    }),
  )

  // Hard delete with cascade — deliberately stays at `:manage`.
  .delete("/api/v1/analytics/reports/:reportId", "deleteApiV1AnalyticsReportsByReportId")
  .withSharedPath(ANALYTICS_REPORTS)
  .withAudit("dashboards.delete")
  .withParams(reportRestParamsSchema)
  .withPermission("analytics:manage")
  .withConfirmation({
    resource: "dashboard",
    action: "delete",
    idParam: "reportId",
    name: (target) => reportOperations.nameForDelete(target),
  })
  .withOutput(dashboardDeletedResponseSchema)
  .withDocs({
    tags: REPORT_TAGS,
    description: "Delete a dashboard and its graphs (hard delete, cascade)",
  })
  .handle(({ app, input, scope, actor }) =>
    reportOperations.delete({
      app,
      projectId: scope.id,
      dashboardId: input.reportId,
      ...viewerOfActor({ actor }),
    }),
  )
  .build();

/** One dashboard as this family answers it: the row plus where it opens. */
async function withLink({
  app,
  projectId,
  dashboard,
}: Readonly<{
  app: DashboardApi;
  projectId: string;
  dashboard: Pick<Dashboard, "id" | "name" | "order" | "createdAt" | "updatedAt">;
}>) {
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
