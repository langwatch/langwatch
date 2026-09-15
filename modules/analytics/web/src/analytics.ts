/**
 * The analytics family, as the browser application mounts it: nine keys across
 * eight screens (the chart builder serves two, via a MODE prop). Each entry is a
 * lazy loader, since every screen drags a chart library, filter editor or query
 * workbench that must not land in the app's main chunk. The owning feature mounts
 * the tRPC Provider these hooks run on, plus a host port for the project, grants,
 * address and notices.
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
 * Three of these nine keys (`reports`, the two custom-chart keys) belong to
 * `@langwatch/dashboard-server` under the transport-ownership rule, but stay here
 * under the rule's own type exception: `graphPayloadSchema` is untyped, while these
 * screens name `CustomGraphInput` end to end. Splitting would also duplicate
 * `CustomGraph`, the 1,700-line renderer six of these screens share with the report
 * grid and the builder's preview, since a web package may not import another.
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
