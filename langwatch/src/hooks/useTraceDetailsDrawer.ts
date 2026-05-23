import { useCallback } from "react";
import type { DrawerProps } from "../components/drawerRegistry";
import { useTracesV2Preference } from "../features/traces-v2/hooks/useTracesV2Preference";
import { useDrawer } from "./useDrawer";

/**
 * Convenience hook for opening the trace details drawer.
 *
 * EXTERNAL user restriction is enforced centrally in `CurrentDrawer` —
 * any `openDrawer("traceDetails", ...)` call (whether through this hook
 * or directly) is automatically intercepted for EXTERNAL users.
 *
 * Routes to the v2 drawer when the operator has clicked "Try the new
 * one" at least once on this device (the preference lives in
 * localStorage; see `useTracesV2Preference`); otherwise the legacy v1
 * drawer.
 */
export function useTraceDetailsDrawer() {
  const { openDrawer } = useDrawer();
  const { preferred: prefersV2 } = useTracesV2Preference();

  const openTraceDetailsDrawer = useCallback(
    (props?: Partial<DrawerProps<"traceDetails">>) => {
      if (prefersV2 && props?.traceId) {
        openDrawer("traceV2Details", { traceId: props.traceId });
        return;
      }
      openDrawer("traceDetails", props);
    },
    [openDrawer, prefersV2],
  );

  return { openTraceDetailsDrawer };
}
