import type { DrawerType } from "../components/drawerRegistry";

/**
 * Route a drawer-open request to the new Trace Explorer when this device has
 * opted into traces v2.
 *
 * The new drawer ships as a per-device opt-in: once the operator chooses it,
 * every trace they open should use it, regardless of which screen triggered
 * the open. Instead of each "view trace" call site re-checking the preference
 * (several historically forgot to, so evaluation results and workflow panels
 * stayed on the legacy drawer), all opens funnel through `openDrawer`, which
 * routes here. A `traceDetails` open carrying a trace id becomes a
 * `traceV2Details` open; every other drawer — and a trace open with no id —
 * passes through untouched.
 *
 * Kept pure (the preference is read by the caller and passed in, and the only
 * import is a type) so the branch logic is testable without touching
 * localStorage, a router, or the drawer component registry.
 */
export function routeTraceDrawerForV2(
  drawer: DrawerType,
  props: Record<string, unknown> | undefined,
  prefersV2: boolean,
): { drawer: DrawerType; props: Record<string, unknown> | undefined } {
  if (
    prefersV2 &&
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
