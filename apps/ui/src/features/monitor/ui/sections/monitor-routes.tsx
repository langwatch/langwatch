/**
 * Which page key the online evaluations screen answers, and what it is wrapped
 * in.
 *
 * ONE KEY, ONE SCREEN. The guard states the policy the platform higher-order
 * component carried — `withPermissionGuard("evaluations:view")`, unchanged.
 */

import { monitorScreens } from "@langwatch/monitor-web/screens/online-evaluations";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { MonitorHost } from "./monitor-host";

/** The grant the platform page carried, unchanged. */
export const ONLINE_EVALUATIONS_PAGE_PERMISSION = "evaluations:view";

export const monitorPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/online-evaluations": uiPage({
    screen: monitorScreens.onlineEvaluations,
    host: MonitorHost,
    permission: ONLINE_EVALUATIONS_PAGE_PERMISSION,
  }),
};
