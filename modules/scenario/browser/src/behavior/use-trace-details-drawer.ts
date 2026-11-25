import { useDrawer } from "@langwatch/browser-host/drawer";
import { useCallback } from "react";

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
