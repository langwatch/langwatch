/**
 * Route a drawer-open request to the Trace Explorer drawer.
 *
 * Moved out of `platform/app/src/hooks/traceDrawerV2Routing.ts`. It sat INSIDE
 * the drawer navigator there, which meant framework code named two drawers by
 * hand. The rule is a feature's and the framework takes it as an install, so it
 * lives here — beside the registry that names those two drawers — and
 * `installDrawerOpenRewrite` hands it over.
 *
 * The Trace Explorer is the trace experience: every request to open a trace's
 * details — no matter which screen triggered it (evaluation results, workflow
 * run panels, the command bar, a feedback row) — opens the new drawer. Instead
 * of each "view trace" call site deciding which drawer to use (several
 * historically diverged), all opens funnel through `openDrawer`, which routes
 * here. A `traceDetails` open carrying a trace id becomes a `traceV2Details`
 * open; every other drawer — and a trace open with no id — passes through
 * untouched.
 *
 * Kept pure so the branch logic is testable without touching a router or the
 * drawer registry.
 */

import type { DrawerOpenRewrite } from "@langwatch/ui-drawer";

export const routeTraceDrawerForV2: DrawerOpenRewrite = (drawer, props) => {
  if (drawer === "traceDetails" && typeof props?.traceId === "string" && props.traceId) {
    return {
      drawer: "traceV2Details",
      props: {
        traceId: props.traceId,
        // `t` is the v2 drawer's partition-pruning timestamp hint; forward it
        // when a caller happens to have it, otherwise the drawer fetches by id.
        ...(typeof props.t === "string" && props.t ? { t: props.t } : {}),
      },
    };
  }
  return { drawer, props };
};
