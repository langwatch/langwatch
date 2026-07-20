import { Box } from "@chakra-ui/react";
import { type ReactNode, useEffect } from "react";
import { Outlet, useParams } from "react-router";
import { LangySidecar } from "./components/LangyPanel";
import { useShowLangy } from "./hooks/useShowLangy";
import { LangyProvider, useLangy } from "./LangyContext";
import {
  LANGY_DOCKED_OFFSET,
  LANGY_TRANSITION,
} from "./logic/langyPanelLayout";
import { useLangyStore } from "./stores/langyStore";

/**
 * Layout route that mounts Langy once per project, above the swapping page.
 *
 * Mounting Langy here — rather than inside the per-page DashboardLayout — is
 * what lets the panel, the composer draft, and any in-flight response survive
 * navigation between pages of the same project: React Router keeps this layout
 * route mounted and only swaps the <Outlet/> beneath it.
 *
 * The provider is keyed by the :project URL segment, so Langy resets cleanly
 * when the user switches projects (its conversations and memory are
 * project-scoped). Visibility itself is unchanged from the previous
 * DashboardLayout gate — see useShowLangy.
 *
 * Spec: specs/langy/langy-navigation-persistence.feature
 */
export default function ProjectLangyLayout() {
  const { project: projectSlug } = useParams();
  const showLangy = useShowLangy();

  return (
    <LangyProvider key={projectSlug}>
      <LangyShiftedRoot showLangy={showLangy}>
        <Outlet />
      </LangyShiftedRoot>
    </LangyProvider>
  );
}

/**
 * Wraps the routed page in a box that reserves room on the right while the
 * docked panel is open (so content slides over instead of hiding under it),
 * and renders the panel itself as a sibling. The page-chrome box (background,
 * min-height) stays in DashboardLayout so non-project routes are unaffected.
 *
 * When the page renders an app shell (DashboardLayout), the SHELL claims the
 * dock instead: it keeps its header full-width and reserves the room inside
 * its own content row, so the docked panel can sit as a second content card
 * below the header. This wrapper then stands down, padding here too would
 * reserve the width twice. Spec: specs/langy/langy-panel-layout.feature
 */
function LangyShiftedRoot({
  showLangy,
  children,
}: {
  showLangy: boolean;
  children: ReactNode;
}) {
  const isOpen = useLangyStore((s) => s.isOpen);
  const panelMode = useLangyStore((s) => s.panelMode);
  const shellClaimed = useLangyStore((s) => s.dockShellClaims > 0);
  const setDockShifted = useLangyStore((s) => s.setDockShifted);
  // Only Sidebar mode reserves room (pushes content left). Floating mode
  // overlays the page — content stays full width and the card floats over it.
  const shifted = showLangy && isOpen && panelMode === "sidebar";
  // Publish the reservation truth for a claiming shell (see the store): this
  // wrapper owns the visibility gate, the shell only consumes the result.
  useEffect(() => {
    setDockShifted(shifted);
    return () => setDockShifted(false);
  }, [shifted, setDockShifted]);
  // Who reserves the dock's room right now: the page wrapper ("page"), a
  // claiming app shell ("shell"), or nobody ("none", panel closed/floating).
  const reservation = !shifted ? "none" : shellClaimed ? "shell" : "page";
  return (
    <>
      <Box
        width="full"
        data-langy-dock={reservation}
        paddingRight={reservation === "page" ? `${LANGY_DOCKED_OFFSET}px` : 0}
        transition={`padding-right ${LANGY_TRANSITION}`}
      >
        {children}
      </Box>
      {showLangy && <LangySidecarConnected />}
    </>
  );
}

function LangySidecarConnected() {
  const { proposalHandlersRef } = useLangy();
  return <LangySidecar proposalHandlersRef={proposalHandlersRef} />;
}
