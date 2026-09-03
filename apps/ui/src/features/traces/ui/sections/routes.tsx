/**
 * Two page keys, wrapped in the host — outside the guard, since an accepted
 * page needs the host mounted before render. `/share/:id` has NO guard by
 * design: a share link must work for a reader with no account.
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
