import { useCallback } from "react";
import type { DrawerProps } from "../components/drawerRegistry";
import { useDrawer } from "./useDrawer";

/**
 * Convenience hook for opening the trace details drawer.
 *
 * It is a thin wrapper around `openDrawer("traceDetails", …)`. Both
 * cross-cutting concerns are enforced centrally, so every trace open — through
 * this hook or a direct `openDrawer` call — behaves identically:
 * - EXTERNAL-user restriction, in `CurrentDrawer`.
 * - Trace Explorer default routing, in `openDrawer` (a trace open is sent to
 *   the Trace Explorer everywhere except the legacy Traces page; see
 *   `routeTraceDrawerForV2`).
 */
export function useTraceDetailsDrawer() {
  const { openDrawer } = useDrawer();

  const openTraceDetailsDrawer = useCallback(
    (props?: Partial<DrawerProps<"traceDetails">>) => {
      openDrawer("traceDetails", props);
    },
    [openDrawer],
  );

  return { openTraceDetailsDrawer };
}
