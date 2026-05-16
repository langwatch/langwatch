import { useCallback } from "react";
import type { DrawerProps } from "../components/drawerRegistry";
import { useTracesV2Preference } from "../features/traces-v2/hooks/useTracesV2Preference";
import { useDrawer } from "./useDrawer";
import { useFeatureFlag } from "./useFeatureFlag";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

/**
 * Convenience hook for opening the trace details drawer.
 *
 * EXTERNAL user restriction is enforced centrally in `CurrentDrawer` —
 * any `openDrawer("traceDetails", ...)` call (whether through this hook
 * or directly) is automatically intercepted for EXTERNAL users.
 *
 * Routes to the v2 drawer when both (a) the project has the
 * `release_ui_traces_v2_enabled` rollout flag on, and (b) the operator
 * has clicked "Try the new one" at least once on this device (the
 * preference lives in localStorage — see `useTracesV2Preference`).
 * Either knob off → legacy v1 drawer.
 */
export function useTraceDetailsDrawer() {
  const { openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { enabled: tracesV2Released } = useFeatureFlag(
    "release_ui_traces_v2_enabled",
    { projectId: project?.id, enabled: !!project?.id },
  );
  const { preferred: prefersV2 } = useTracesV2Preference();
  const useV2 = tracesV2Released && prefersV2;

  const openTraceDetailsDrawer = useCallback(
    (props?: Partial<DrawerProps<"traceDetails">>) => {
      if (useV2 && props?.traceId) {
        openDrawer("traceV2Details", { traceId: props.traceId });
        return;
      }
      openDrawer("traceDetails", props);
    },
    [openDrawer, useV2],
  );

  return { openTraceDetailsDrawer };
}
