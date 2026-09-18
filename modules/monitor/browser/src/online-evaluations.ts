/**
 * The online evaluations screen; its own package because all writes are
 * monitors.* transported by monitor-server.
 */

export { monitorApi } from "./behavior/monitor-api.ts";
export type { MonitorApiMap, MonitorExperimentRow } from "./behavior/monitor-api.ts";
export {
  MonitorHostApi,
  MonitorHostProvider,
  ONLINE_EVALUATIONS_PAGE_PERMISSION,
  type MonitorCopyTarget,
  type MonitorFailureNotice,
  type MonitorOverlayRequest,
  type MonitorRouteReading,
  type MonitorScope,
  type MonitorSuccessNotice,
} from "./model/monitor-host.ts";
