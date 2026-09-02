export { PostgresDashboardAdapter } from "./adapters/postgres.dashboard.adapter";
export { PostgresSavedViewAdapter } from "./adapters/postgres.saved-view.adapter";
export {
  DashboardGraphVisibilityPolicyPort,
  DashboardIdGenerator,
  SavedWorkbenchChartPolicy,
} from "./ports/dashboard.port";
export { DashboardTrpcApi, type DashboardTrpcContext } from "./transport/api-trpc/dashboard.api";
export {
  GraphTrpcApi,
  type GraphTrpcContext,
  type GraphTrpcPorts,
} from "./transport/api-trpc/graph.api";
export {
  SavedViewNotThereError,
  SavedViewReorderUnknownIdsError,
  SavedViewTrpcApi,
  type SavedViewTrpcContext,
  type SavedViewTrpcPorts,
  type SavedViewsPort,
  type SavedViewPeriod,
} from "./transport/api-trpc/saved-view.api";
export {
  SavedWorkbenchChartTrpcApi,
  type SavedWorkbenchChartTrpcContext,
  type SavedWorkbenchChartTrpcPorts,
} from "./transport/api-trpc/saved-workbench-chart.api";

/**
 * The feature's application: the one object every door calls, and the refusals
 * it names. The process composes it from the dashboard service and the alert
 * lookup the chart cards read.
 */
export {
  DashboardApp,
  DashboardNotThereError,
  DashboardReorderUnknownIdsError,
  GraphNotThereError,
  type DashboardAppDependencies,
  type DashboardGraphAlertLookup,
} from "./app/dashboard.app";

/**
 * The REST families this feature owns. The process supplies the bound REST
 * security service, a resolver for the application and its own platform-URL
 * builder; the base paths, access declarations, schemas and delegation are the
 * feature's.
 */
export { createGraphsRestApp } from "./transport/api-rest/graph.api";
export { createDashboardsRestApp } from "./transport/api-rest/dashboard.api";

/**
 * The two policies a process used to compose by hand.
 *
 * Both are Dashboard's own decisions expressed against collaborators it does
 * not own — the LangWatchQL validator over a saved chart's SQL, and the
 * workbench rollout flag over which graph kinds a project may place — so they
 * live here as adapters a composition root binds, rather than as a shape every
 * deployment restates.
 */
export { AnalyticsSavedWorkbenchChartPolicy } from "./adapters/saved-workbench-chart-policy.adapter";
export { mapDashboardSavedWorkbenchChartError } from "./adapters/saved-workbench-chart-policy.adapter";
export { WorkbenchAwareGraphVisibilityPolicy } from "./adapters/graph-visibility-policy.adapter";
export {
  SavedWorkbenchChartAlreadyExistsError,
  SavedWorkbenchChartDashboardNotFoundError,
  SavedWorkbenchChartDefinitionInvalidError,
  SavedWorkbenchChartNotFoundError,
  SavedWorkbenchChartSpecificationRefusedError,
} from "./transport/api-trpc/saved-workbench-chart.transport-errors";
