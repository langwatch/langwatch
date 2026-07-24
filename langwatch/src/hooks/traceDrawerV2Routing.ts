import type { DrawerType } from "../components/drawerRegistry";

/**
 * Route a drawer-open request to the Trace Explorer drawer.
 *
 * The Trace Explorer is the default trace experience: every request to open a
 * trace's details — no matter which screen triggered it (evaluation results,
 * workflow run panels, the command bar, a feedback row) — opens the new
 * drawer. Instead of each "view trace" call site deciding which drawer to use
 * (several historically diverged), all opens funnel through `openDrawer`,
 * which routes here. A `traceDetails` open carrying a trace id becomes a
 * `traceV2Details` open; every other drawer — and a trace open with no id —
 * passes through untouched.
 *
 * The single exception is the legacy Traces page itself: an operator who
 * deliberately navigated to the legacy view gets the legacy drawer there, so
 * the page stays coherent until it is removed.
 *
 * Kept pure (the caller decides whether it is on the legacy page and passes
 * that in, and the only import is a type) so the branch logic is testable
 * without touching a router or the drawer component registry.
 */
export function routeTraceDrawerForV2(
  drawer: DrawerType,
  props: Record<string, unknown> | undefined,
  onLegacyTracesPage: boolean,
): { drawer: DrawerType; props: Record<string, unknown> | undefined } {
  if (
    !onLegacyTracesPage &&
    drawer === "traceDetails" &&
    typeof props?.traceId === "string" &&
    props.traceId
  ) {
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
