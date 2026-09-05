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
 * The REST families this feature owns. The process supplies the bound REST security service, a
 * resolver for the application and its own platform-URL builder; the base paths, access
 * declarations, schemas and delegation are the feature's.
 */
export { createGraphsRestApp } from "./transport/api-rest/graph.api";
export { createDashboardsRestApp } from "./transport/api-rest/dashboard.api";

/**
 * The two policies a process used to compose by hand.
 */
export { AnalyticsSavedWorkbenchChartPolicyAdapter } from "./adapters/saved-workbench-chart-policy.adapter";
export { mapDashboardSavedWorkbenchChartError } from "./adapters/saved-workbench-chart-errors.adapter";
export { WorkbenchAwareGraphVisibilityAdapter } from "./adapters/graph-visibility-policy.adapter";
export { WorkbenchAccessPort } from "./ports/workbench-access.port";
export {
  SavedWorkbenchChartAlreadyExistsError,
  SavedWorkbenchChartDashboardNotFoundError,
  SavedWorkbenchChartDefinitionInvalidError,
  SavedWorkbenchChartNotFoundError,
  SavedWorkbenchChartSpecificationRefusedError,
} from "./adapters/saved-workbench-chart-errors.adapter";
