/**
 * Which page keys the trace screens answer, and what they are wrapped in.
 *
 * TWO KEYS, TWO SCREENS. Both are wrapped in the host, which goes OUTSIDE the
 * guard: a refusal renders the guard's own fallback, which asks nothing of the
 * trace host, but a page that opens needs the host mounted above it before its
 * first render.
 *
 * `/:project/traces` states the policy the platform higher-order component
 * carried — `withPermissionGuard("traces:view")`, unchanged.
 *
 * `/share/:id` HAS NO GUARD, and that absence is the page: a share link is read
 * by somebody who may have no account at all, and a grant in front of it would
 * be a gate in front of the only thing the link is for. The auth front door
 * made the same call for the same reason.
 */

import { traceScreens } from "@langwatch/trace-web/screens/traces";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { TraceHost } from "./trace-host";

const TRACES_PAGE_PERMISSION = "traces:view";

export const tracePageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/traces": uiPage({
    screen: traceScreens.traces,
    host: TraceHost,
    permission: TRACES_PAGE_PERMISSION,
  }),
  "pages/share/[id]": uiPage({
    screen: traceScreens.sharedTrace,
    host: TraceHost,
  }),
};
