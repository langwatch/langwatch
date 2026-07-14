import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { Outlet, useParams } from "react-router";

import { LangyProvider, useLangy } from "./LangyContext";
import { useShowLangy } from "./hooks/useShowLangy";
import {
  LANGY_DOCKED_OFFSET,
  LANGY_TRANSITION,
  LangySidecar,
} from "./components/LangyPanel";
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
  // Only Sidebar mode reserves room (pushes content left). Floating mode
  // overlays the page — content stays full width and the card floats over it.
  const shifted = showLangy && isOpen && panelMode === "sidebar";
  return (
    <>
      <Box
        width="full"
        paddingRight={shifted ? `${LANGY_DOCKED_OFFSET}px` : 0}
        transition={`padding-right ${LANGY_TRANSITION}`}
      >
        {children}
      </Box>
      {showLangy && <LangySidecarConnected />}
    </>
  );
}

function LangySidecarConnected() {
  const { proposalHandlersRef, experimentSlug } = useLangy();
  return (
    <LangySidecar
      proposalHandlersRef={proposalHandlersRef}
      experimentSlug={experimentSlug}
    />
  );
}
