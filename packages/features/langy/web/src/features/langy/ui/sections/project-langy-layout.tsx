import { Box } from "@chakra-ui/react";
import { memo, type ReactNode, useEffect } from "react";
import { useDrawer } from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { LangySidecar } from "./langy-panel";
import { useLangyScopeReset } from "../../behavior/use-langy-scope-reset";
import { useShowLangy } from "../../behavior/use-show-langy";
import { LangyProvider, useLangy } from "./langy-context";
import { LANGY_DOCKED_OFFSET, LANGY_TRANSITION, useLangyStore } from "../../../../index";

/**
 * Layout route that mounts Langy once per project, above the swapping page.
 * Spec: specs/langy/langy-navigation-persistence.feature
 */
export default function ProjectLangyLayout({ children }: { children?: ReactNode }) {
  const showLangy = useShowLangy();
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  useLangyScopeReset();

  return (
    <ProjectLangySubtree projectId={project?.id ?? "no-project"} showLangy={showLangy}>
      {children}
    </ProjectLangySubtree>
  );
}

/**
 * A memo boundary between the layout's subscriptions and the whole routed app.
 */
const ProjectLangySubtree = memo(function ProjectLangySubtree({
  projectId,
  showLangy,
  children,
}: {
  projectId: string;
  showLangy: boolean;
  children?: ReactNode;
}) {
  return (
    <LangyProvider key={projectId}>
      <LangyShiftedRoot showLangy={showLangy}>{children}</LangyShiftedRoot>
    </LangyProvider>
  );
});

/**
 * Wraps the routed page in a box that reserves room on the right while the docked panel
 * is open (so content slides over instead of hiding under it), and renders the panel
 * itself as a sibling.
 */
function LangyShiftedRoot({ showLangy, children }: { showLangy: boolean; children: ReactNode }) {
  const isOpen = useLangyStore((s) => s.isOpen);
  const panelMode = useLangyStore((s) => s.panelMode);
  const shellClaimed = useLangyStore((s) => s.dockShellClaims > 0);
  const setDockShifted = useLangyStore((s) => s.setDockShifted);
  // While a drawer is open the panel rides beside it as a floating companion
  // (see LangyPanel), so the dock's reservation releases and the page gets
  // its width back underneath the overlay pair.
  const { currentDrawer } = useDrawer();
  // Only Sidebar mode reserves room (pushes content left). Floating mode
  // overlays the page — content stays full width and the card floats over it.
  const shifted = showLangy && isOpen && panelMode === "sidebar" && !currentDrawer;
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
  const { proposalHandlersRef, actionHandlersRef } = useLangy();
  return (
    <LangySidecar proposalHandlersRef={proposalHandlersRef} actionHandlersRef={actionHandlersRef} />
  );
}
