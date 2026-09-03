/**
 * Which page key each analytics screen answers, and what it is wrapped in.
 *
 * NINE KEYS, EIGHT SCREENS. Seven addresses are their own screen; the chart
 * builder serves two and is TOLD which by a `mode` prop, so nothing has to read
 * the address to learn what the router already knew — the automations family's
 * tab-as-prop shape, applied to a form. The graph `:id` itself is a route
 * PARAMETER, which the router captured.
 *
 * THE POLICY IS THE PLATFORM PAGES', ONE FOR ONE, AND HERE ALL NINE AGREE:
 * every one of the nine page files was `withPermissionGuard("analytics:view")`.
 */

import {
  analyticsScreens,
  type CustomGraphScreenMode,
} from "@langwatch/analytics-web/screens/analytics";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { AnalyticsHost } from "./analytics-host";

/** The grant every one of the nine platform pages asked for, unchanged. */
const ANALYTICS_PAGE_PERMISSION = "analytics:view";

/** Guards one screen and mounts the analytics host above it. */
function analyticsPage(load: () => Promise<{ default: ComponentType }>): UiPageLoader {
  return uiPage({ screen: load, host: AnalyticsHost, permission: ANALYTICS_PAGE_PERMISSION });
}

/** The builder, told which of its two addresses this is. */
function customGraphPage(mode: CustomGraphScreenMode): UiPageLoader {
  return uiPage({
    screen: async () => {
      const Screen = (await analyticsScreens.customGraph()).default;
      const OnMode = () => <Screen mode={mode} />;
      OnMode.displayName = `CustomGraphPage(${mode})`;
      return { default: OnMode as ComponentType };
    },
    host: AnalyticsHost,
    permission: ANALYTICS_PAGE_PERMISSION,
  });
}

export const analyticsPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/analytics/index": analyticsPage(analyticsScreens.overview),
  "pages/[project]/analytics/users": analyticsPage(analyticsScreens.users),
  "pages/[project]/analytics/topics": analyticsPage(analyticsScreens.topics),
  "pages/[project]/analytics/metrics": analyticsPage(analyticsScreens.metrics),
  "pages/[project]/analytics/evaluations": analyticsPage(analyticsScreens.evaluations),
  "pages/[project]/analytics/reports": analyticsPage(analyticsScreens.reports),
  "pages/[project]/analytics/query": analyticsPage(analyticsScreens.query),
  "pages/[project]/analytics/custom/index": customGraphPage("new"),
  "pages/[project]/analytics/custom/[id]": customGraphPage("edit"),
};
