/**
 * Which page key the online evaluations screen answers, and what it is wrapped
 * in.
 *
 * ONE KEY, ONE SCREEN. The host provider is OUTSIDE the guard: a refusal
 * renders the guard's own fallback, which asks nothing of the monitor host, but
 * a page that opens needs the host mounted above it before its first render.
 * Inside that, the guard states the policy the platform higher-order component
 * carried — `withPermissionGuard("evaluations:view")`, unchanged.
 */

import { monitorScreens } from "@langwatch/monitor-web/screens/online-evaluations";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { ONLINE_EVALUATIONS_PAGE_PERMISSION } from "../../behavior/monitor-host.adapter";
import { withMonitorHost } from "./monitor-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

export const monitorPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/online-evaluations": async () => {
    const module = await monitorScreens.onlineEvaluations();
    const guarded = withUiPageGuard({
      permission: ONLINE_EVALUATIONS_PAGE_PERMISSION,
      fallbacks: FALLBACKS,
    })(module.default);
    guarded.displayName = "OnlineEvaluationsPage";
    return { default: withMonitorHost(guarded) };
  },
};
