import { useCallback } from "react";
import { useDrawer } from "@langwatch/ui-drawer";

/**
 * Convenience hook for opening a trace's details.
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
