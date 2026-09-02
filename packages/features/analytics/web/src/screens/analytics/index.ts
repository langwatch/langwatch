/**
 * The analytics family, as the browser application mounts it.
 *
 * NINE KEYS, EIGHT SCREENS. Seven addresses are their own screen; the chart
 * builder serves two (`/analytics/custom` and `/analytics/custom/:id`) and takes
 * its MODE as a prop, which is the automations family's tab-as-prop shape
 * applied to a form. Every entry is a LOADER rather than a component, because
 * each screen drags a chart library, a filter editor or a query workbench
 * behind it and none of that belongs in the chunk that renders the rest of the
 * application.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is two things: the tRPC
 * Provider this package's hooks run on, and the host port that answers for the
 * project, the reader's grants, the address and the two notices.
 *
 * The ownership call — why three of these nine keys address another feature's
 * transport and live here anyway — is stated on `analyticsScreens` below.
 */

import type { ComponentType } from "react";
import type { CustomGraphScreenMode } from "./custom-graph.screen";

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
 * THE FIRST FAMILY WHERE THE TRANSPORT RULE WAS OVERRULED, AND WHY.
 *
 * The credentials family's rule — a key belongs to the family that owns its
 * TRANSPORT, with the type rule as the exception — puts three of these keys
 * elsewhere: `reports` names ONLY `dashboards.*` and `graphs.*`, and the two
 * custom-chart keys name `graphs.*` for everything they store. All three are
 * `@langwatch/dashboard-server`'s. They are here anyway, for four reasons.
 *
 * ONE: the rule already disagrees with itself in this vertical. The
 * application's own mount file says `analytics.savedWorkbenchCharts` belong to
 * dashboard "even though the namespace a member reaches them through is
 * `analytics.savedWorkbenchCharts`". Namespace and subject are already crossed.
 *
 * TWO: the type rule — the rule's own exception — points here for all nine.
 * `graphPayloadSchema` is `z.record(z.string(), z.unknown())`: the dashboard
 * contract declines to know what it stores. The type these screens name is
 * `CustomGraphInput`, which is the analytics registry's vocabulary end to end.
 *
 * THREE: a split costs a second copy of the renderer. `CustomGraph` is 1,700
 * lines and is the single engine behind six of these screens, the report grid's
 * cards AND the builder's preview; a web package may not import another, so
 * splitting means duplicating it plus the layout, the filter rail, the period
 * control and the filter catalogue.
 *
 * FOUR: addressing the other features costs nothing. A procedure map names
 * STRINGS, and only two CONTRACTS are imported — portable by construction.
 *
 * RECORDED so it is a decision rather than a drift: if a `@langwatch/dashboard-web`
 * is ever created, these three keys are the ones to re-examine, and the first
 * blocker to look at is publishing the renderer as a SURFACE.
 */
export const analyticsScreens = {
  overview: () => import("./analytics-overview.screen"),
  users: () => import("./analytics-users.screen"),
  topics: () => import("./analytics-topics.screen"),
  metrics: () => import("./analytics-metrics.screen"),
  evaluations: () => import("./analytics-evaluations.screen"),
  reports: () => import("./analytics-reports.screen"),
  query: () => import("./analytics-query.screen"),
  customGraph: () => import("./custom-graph.screen"),
} as const satisfies Record<string, PlainScreenLoader | CustomGraphScreenLoader>;

export type AnalyticsScreenName = keyof typeof analyticsScreens;

export type { CustomGraphScreenMode };
export { analyticsApi } from "../../behavior/analytics-api";
export {
  AnalyticsHostPort,
  AnalyticsHostProvider,
  useAnalyticsHost,
  type AnalyticsFailureNotice,
  type AnalyticsHostProject,
  type AnalyticsRouteReading,
  type AnalyticsSuccessNotice,
} from "../../model/analytics-host";
