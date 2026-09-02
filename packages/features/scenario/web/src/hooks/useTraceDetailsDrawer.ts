import { useCallback } from "react";
import { useDrawer } from "@langwatch/ui-drawer";

/**
 * Convenience hook for opening a trace's details.
 *
 * A thin wrapper around `openDrawer("traceV2Details", …)` — the Trace Explorer
 * drawer is the trace experience, and `GlobalTraceV2DrawerMount` mounts it on
 * every page, so this works from anywhere. The EXTERNAL-user restriction is
 * enforced centrally in `CurrentDrawer`, so every trace open behaves the same
 * whether it comes through this hook or a direct `openDrawer` call.
 */
export function useTraceDetailsDrawer() {
  const { openDrawer } = useDrawer();

  const openTraceDetailsDrawer = useCallback(
    (props?: Record<string, unknown>) => {
      openDrawer("traceV2Details", props);
    },
    [openDrawer],
  );

  return { openTraceDetailsDrawer };
}
