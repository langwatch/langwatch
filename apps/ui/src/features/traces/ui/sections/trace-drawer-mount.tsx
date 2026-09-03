/**
 * The trace drawer, mounted above every page this application serves.
 *
 * THE GAP THIS CLOSES. `routeTraceDrawerForV2` rewrites every `traceDetails`
 * open into `traceV2Details`, and `traceV2Details` is not a registered drawer —
 * it cannot be, because its URL → store sync has to outlive the
 * `?drawer.open=` parameter. `platform/app` mounted the shell from
 * `DashboardPageBody`; when the shell moved into `@langwatch/navigation-web`
 * the mount did not travel with it, so every "View trace" affordance in the
 * product wrote an address and nothing opened. Only `/:project/traces` worked,
 * because that page mounts its own copy — which is also why the package's mount
 * stands down there.
 *
 * IT IS THE HOST THAT MAKES IT THIS FEATURE'S. The drawer reads the trace
 * family's host port for the project, the reader and their grants, exactly as
 * the two screens do, so it is wrapped in the same provider they are. What the
 * chrome mounts is one element with no props.
 *
 * LAZY, because the chrome is on the path to every signed-in page and the
 * drawer drags the waterfall, the transcript renderer and their syntax
 * highlighters behind it. Nothing renders until a trace is actually open, so
 * the fallback is `null` rather than a spinner over the page.
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
