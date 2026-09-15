/**
 * The online evaluations screen; its own package because all writes are
 * monitors.* transported by monitor-server.
 */

import type { ComponentType } from "react";

export type MonitorScreenLoader = () => Promise<{ default: ComponentType }>;

export const monitorScreens = {
  onlineEvaluations: () => import("./ui/sections/online-evaluations.screen.tsx"),
} as const satisfies Record<string, MonitorScreenLoader>;

export type MonitorScreenName = keyof typeof monitorScreens;

export { ONLINE_EVALUATIONS_PAGE_PERMISSION } from "./ui/sections/online-evaluations.screen.tsx";
export { monitorApi } from "./behavior/monitor-api.ts";
export type { MonitorApiMap, MonitorExperimentRow } from "./behavior/monitor-api.ts";
export {
  MonitorHostApi,
  MonitorHostProvider,
  type MonitorCopyTarget,
  type MonitorFailureNotice,
  type MonitorOverlayRequest,
  type MonitorRouteReading,
  type MonitorScope,
  type MonitorSuccessNotice,
} from "./model/monitor-host.ts";
