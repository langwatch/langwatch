import type { DrawerType } from "../components/drawerRegistry";

/**
 * Route a drawer-open request to the Trace Explorer drawer.
 *
 * The Trace Explorer is the trace experience: every request to open a trace's
 * details — no matter which screen triggered it (evaluation results, workflow
 * run panels, the command bar, a feedback row) — opens the new drawer.
 * Instead of each "view trace" call site deciding which drawer to use (several
 * historically diverged), all opens funnel through `openDrawer`, which routes
 * here. A `traceDetails` open carrying a trace id becomes a `traceV2Details`
 * open; every other drawer — and a trace open with no id — passes through
 * untouched.
 *
 * Both legacy surfaces are gone — the Traces page and the drawer it opened —
 * and every call site now names `traceV2Details` outright. This stays as the
 * funnel it always was: a `traceDetails` open reaching `openDrawer` from
 * anywhere lands on the Trace Explorer drawer directly, rather than on the
 * redirect that serves links naming the old drawer in the address bar. Those
 * links have to round-trip through the URL; a call in code does not.
 *
 * Kept pure (the only import is a type) so the branch logic is testable
 * without touching a router or the drawer component registry.
 */
export function routeTraceDrawerForV2(
  drawer: DrawerType,
  props: Record<string, unknown> | undefined,
): { drawer: DrawerType; props: Record<string, unknown> | undefined } {
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
}
