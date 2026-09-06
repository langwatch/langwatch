export { PostgresDashboardAdapter } from "./adapters/postgres.dashboard.adapter.ts";
export { PostgresSavedViewAdapter } from "./adapters/postgres.saved-view.adapter.ts";
export {
  DashboardGraphVisibilityPolicyPort,
  DashboardIdGenerator,
  SavedWorkbenchChartPolicy,
} from "./ports/dashboard.port.ts";
export { DashboardTrpcApi, type DashboardTrpcContext } from "./transport/api-trpc/dashboard.api.ts";
export {
  GraphTrpcApi,
  type GraphTrpcContext,
  type GraphTrpcPorts,
} from "./transport/api-trpc/graph.api.ts";
export {
  SavedViewNotThereError,
  SavedViewReorderUnknownIdsError,
  SavedViewTrpcApi,
  type SavedViewTrpcContext,
  type SavedViewTrpcPorts,
  type SavedViewsPort,
  type SavedViewPeriod,
} from "./transport/api-trpc/saved-view.api.ts";
export {
  SavedWorkbenchChartTrpcApi,
  type SavedWorkbenchChartTrpcContext,
  type SavedWorkbenchChartTrpcPorts,
} from "./transport/api-trpc/saved-workbench-chart.api.ts";

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
} from "./app/dashboard.app.ts";

/**
 * The REST families this feature owns. The process supplies the bound REST security service, a
 * resolver for the application and its own platform-URL builder; the base paths, access
 * declarations, schemas and delegation are the feature's.
 */
export { createGraphsRestApp } from "./transport/api-rest/graph.api.ts";
export { createDashboardsRestApp } from "./transport/api-rest/dashboard.api.ts";

/**
 * The two policies a process used to compose by hand.
 */
export { AnalyticsSavedWorkbenchChartPolicyAdapter } from "./adapters/saved-workbench-chart-policy.adapter.ts";
export { SavedWorkbenchChartErrorsAdapter } from "./adapters/saved-workbench-chart-errors.adapter.ts";
export { WorkbenchAwareGraphVisibilityAdapter } from "./adapters/graph-visibility-policy.adapter.ts";
export { WorkbenchAccessPort } from "./ports/workbench-access.port.ts";
export {
  SavedWorkbenchChartAlreadyExistsError,
  SavedWorkbenchChartDashboardNotFoundError,
  SavedWorkbenchChartDefinitionInvalidError,
  SavedWorkbenchChartNotFoundError,
  SavedWorkbenchChartSpecificationRefusedError,
} from "./adapters/saved-workbench-chart-errors.adapter.ts";
