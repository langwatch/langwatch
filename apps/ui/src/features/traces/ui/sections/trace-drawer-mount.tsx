/**
 * The trace drawer, mounted above every page rather than through
 * `installed-ui-drawers.ts` — its URL-to-store sync must outlive
 * `?drawer.open=` (see `ui-family-move-manifests.md`). Lazy-loaded.
 */

import { traceDrawerMount } from "@langwatch/trace-web/screens/traces";
import { lazy, Suspense } from "react";

import { withHost } from "../../../../ui/sections/ui-page";
import { TraceHost } from "./trace-host";

const TraceDrawer = lazy(traceDrawerMount);

function TraceDrawerMount() {
  return (
    <Suspense fallback={null}>
      <TraceDrawer />
    </Suspense>
  );
}

export const UiTraceDrawerMount = withHost(TraceHost, TraceDrawerMount);
