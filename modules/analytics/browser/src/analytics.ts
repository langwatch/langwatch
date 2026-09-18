/**
 * Lazy loaders for the analytics screens, since each drags a chart library,
 * filter editor or query workbench that must not land in the main chunk.
 * Callers must also mount the tRPC Provider, a host port, grants and notices.
 */

import type { ComponentType } from "react";

import type { CustomGraphScreenMode } from "./ui/sections/analytics/custom-graph.screen.tsx";

/** A screen that needs nothing from the route beyond its host. */
type PlainScreenLoader = () => Promise<{ default: ComponentType }>;

/**
 * The builder takes its MODE as a prop, so its loader's module type says so.
 * `apps/ui` binds the mode per page key and hands React Router a component that
 * takes none.
 */
type CustomGraphScreenLoader = () => Promise<{
  default: ComponentType<{ mode: CustomGraphScreenMode }>;
}>;

/**
 * These three screens qualify for `@langwatch/dashboard-process` under the
 * transport-ownership rule, but stay here under its own type exception:
 * moving would duplicate the 1,700-line `CustomGraph` renderer they share.
 */
export const analyticsScreens = {
  overview: () => import("./ui/sections/analytics/analytics-overview.screen.tsx"),
  users: () => import("./ui/sections/analytics/analytics-users.screen.tsx"),
  topics: () => import("./ui/sections/analytics/analytics-topics.screen.tsx"),
  metrics: () => import("./ui/sections/analytics/analytics-metrics.screen.tsx"),
  evaluations: () => import("./ui/sections/analytics/analytics-evaluations.screen.tsx"),
  reports: () => import("./ui/sections/analytics/analytics-reports.screen.tsx"),
  query: () => import("./ui/sections/analytics/analytics-query.screen.tsx"),
  customGraph: () => import("./ui/sections/analytics/custom-graph.screen.tsx"),
} as const satisfies Record<string, PlainScreenLoader | CustomGraphScreenLoader>;

export type AnalyticsScreenName = keyof typeof analyticsScreens;

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
