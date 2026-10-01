/**
 * What analytics offers the rest of the browser: its api binding, its host
 * port and the custom-graph mode its screens take. The screens themselves are
 * named by `analytics.web.ts`, which is the one registry of them.
 */

import type { CustomGraphScreenMode } from "./ui/sections/analytics/custom-graph.screen.tsx";

export type { CustomGraphScreenMode };
export { analyticsApi } from "./behavior/analytics-api.ts";
export {
  AnalyticsHostApi,
  AnalyticsHostProvider,
  useAnalyticsHost,
  type AnalyticsFailureNotice,
  type AnalyticsHostProject,
  type AnalyticsRouteReading,
  type AnalyticsSuccessNotice,
} from "./model/analytics-host.ts";
