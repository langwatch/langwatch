/**
 * Which page keys the trace screens answer, and what they are wrapped in.
 *
 * TWO KEYS, TWO SCREENS. Both are wrapped in the host provider, which goes
 * OUTSIDE the guard: a refusal renders the guard's own fallback, which asks
 * nothing of the trace host, but a page that opens needs the host mounted above
 * it before its first render.
 *
 * `/:project/traces` states the policy the platform higher-order component
 * carried — `withPermissionGuard("traces:view")`, unchanged.
 *
 * `/share/:id` HAS NO GUARD, and that absence is the page: a share link is read
 * by somebody who may have no account at all, and a grant in front of it would
 * be a gate in front of the only thing the link is for. The auth front door
 * made the same call for the same reason.
 *
 * `layoutComponent: DashboardLayout` was the other half of both calls and does
 * not travel: chrome belongs to the route tree, and these pages are children of
 * layout routes the composing application serves.
 */

import { traceScreens } from "@langwatch/trace-web/screens/traces";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { TRACES_PAGE_PERMISSION } from "../../behavior/host.adapter";
import { withTraceHost } from "./host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

export const tracePageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/traces": async () => {
    const module = await traceScreens.traces();
    const guarded = withUiPageGuard({
      permission: TRACES_PAGE_PERMISSION,
      fallbacks: FALLBACKS,
    })(module.default);
    guarded.displayName = "TracesPage";
    return { default: withTraceHost(guarded) };
  },
  "pages/share/[id]": async () => {
    const module = await traceScreens.sharedTrace();
    return { default: withTraceHost(module.default) };
  },
};
