/**
 * Which page key each analytics screen answers, and what it is wrapped in.
 * The chart builder serves two keys via a `mode` prop rather than reading
 * the address itself — same shape as the automations tab-as-prop pages.
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
