import { useCallback } from "react";
import type { DrawerProps } from "../components/drawerRegistry";
import { useDrawer } from "./useDrawer";

/**
 * Convenience hook for opening the trace details drawer.
 *
 * EXTERNAL user restriction is enforced centrally in `CurrentDrawer` —
 * any `openDrawer("traceDetails", ...)` call (whether through this hook
 * or directly) is automatically intercepted for EXTERNAL users.
 *
 * This hook exists as a convenience wrapper for components that want a
 * purpose-specific function instead of the generic `openDrawer`.
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
