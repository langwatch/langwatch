/**
 * Which page key each analytics screen answers, and what it is wrapped in.
 *
 * NINE KEYS, EIGHT SCREENS. Seven addresses are their own screen; the chart
 * builder serves two and is TOLD which by a `mode` prop, so nothing has to read
 * the address to learn what the router already knew — the automations family's
 * tab-as-prop shape, applied to a form. The graph `:id` itself is a route
 * PARAMETER, which the router captured.
 *
 * Each page is wrapped twice, and the order matters. The host provider is
 * OUTSIDE the guard: a refusal renders the guard's own fallback, which asks
 * nothing of the analytics host, but a page that opens needs the host mounted
 * above it before its first render. Inside that, the guard states the policy
 * the platform higher-order component carried.
 *
 * THE POLICY IS THE PLATFORM PAGES', ONE FOR ONE, AND HERE ALL NINE AGREE.
 * Every one of the nine page files was `withPermissionGuard("analytics:view")`,
 * so there is no asymmetry to carry and none to invent — unlike the annotations
 * family, where one of four pages was guarded and three were not.
 *
 * `layoutComponent: DashboardLayout` was the other half of two of those calls
 * and does not travel — chrome belongs to the route tree, and these pages are
 * children of a layout route the composing application still serves.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import {
  analyticsScreens,
  type CustomGraphScreenMode,
} from "@langwatch/analytics-web/screens/analytics";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { ANALYTICS_PAGE_PERMISSION } from "../../behavior/analytics-host.adapter";
import { withAnalyticsHost } from "./analytics-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

/** Guards one screen and mounts the analytics host above it. */
function analyticsPage(
  load: () => Promise<{ default: ComponentType }>,
  name: string,
): UiPageLoader {
  return async () => {
    const module = await load();
    const guarded = withUiPageGuard({
      permission: ANALYTICS_PAGE_PERMISSION,
      fallbacks: FALLBACKS,
    })(module.default);
    guarded.displayName = `AnalyticsPage(${name})`;
    return { default: withAnalyticsHost(guarded) };
  };
}

/** The builder, told which of its two addresses this is. */
function customGraphPage(mode: CustomGraphScreenMode): UiPageLoader {
  return async () => {
    const module = await analyticsScreens.customGraph();
    const Screen = module.default;
    const OnMode = () => <Screen mode={mode} />;
    OnMode.displayName = `CustomGraphPage(${mode})`;
    const guarded = withUiPageGuard({
      permission: ANALYTICS_PAGE_PERMISSION,
      fallbacks: FALLBACKS,
    })(OnMode as ComponentType);
    return { default: withAnalyticsHost(guarded) };
  };
}

export const analyticsPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/analytics/index": analyticsPage(analyticsScreens.overview, "overview"),
  "pages/[project]/analytics/users": analyticsPage(analyticsScreens.users, "users"),
  "pages/[project]/analytics/topics": analyticsPage(analyticsScreens.topics, "topics"),
  "pages/[project]/analytics/metrics": analyticsPage(analyticsScreens.metrics, "metrics"),
  "pages/[project]/analytics/evaluations": analyticsPage(
    analyticsScreens.evaluations,
    "evaluations",
  ),
  "pages/[project]/analytics/reports": analyticsPage(analyticsScreens.reports, "reports"),
  "pages/[project]/analytics/query": analyticsPage(analyticsScreens.query, "query"),
  "pages/[project]/analytics/custom/index": customGraphPage("new"),
  "pages/[project]/analytics/custom/[id]": customGraphPage("edit"),
};
