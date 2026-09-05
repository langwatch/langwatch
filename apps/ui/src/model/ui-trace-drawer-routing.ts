/**
 * Route a drawer-open request to the Trace Explorer drawer.
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
