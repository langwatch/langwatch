import { Box } from "@chakra-ui/react";
import { memo, type ReactNode, useEffect } from "react";
import { useDrawer } from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { LangySidecar } from "./components/LangyPanel";
import { useLangyScopeReset } from "./hooks/useLangyScopeReset";
import { useShowLangy } from "./hooks/useShowLangy";
import { LangyProvider, useLangy } from "./LangyContext";
import {
  LANGY_DOCKED_OFFSET,
  LANGY_TRANSITION,
  useLangyStore,
} from "../../index";

/**
 * Layout route that mounts Langy once per project, above the swapping page.
 *
 * Mounting Langy here — rather than inside the per-page DashboardLayout — is
 * what lets the panel, the composer draft, and any in-flight response survive
 * navigation between pages of the same project: React Router keeps this layout
 * route mounted and only swaps the <Outlet/> beneath it.
 *
 * The provider is keyed by the AMBIENT project (not the URL segment): settings
 * pages carry no :project param but still resolve the project the user is
 * working in, so the panel survives hopping between a project page and its
 * settings, and resets cleanly when the resolved project actually changes
 * (conversations and memory are project-scoped). Visibility itself is
 * unchanged from the previous DashboardLayout gate — see useShowLangy.
 *
 * The remount key is NOT the reset, though it reads like one: Langy's stores are
 * module singletons and survive it on purpose. `useLangyScopeReset` is what
 * actually draws the boundary, and it draws it around all three of user,
 * organization and project — a key on the project id alone cannot see a change
 * of account on the same project.
 *
 * THE OUTLET IS THE COMPOSITION'S. This used to render react-router's
 * `<Outlet/>` itself; a feature package may not name the router, and which
 * router sits below a layout is the composing application's business anyway.
 * It takes `children` now and the application passes the outlet — the mount
 * boundary and the memo below it are unchanged, so the property this layout
 * exists for is unchanged with them.
 *
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
 *
 * `useOrganizationTeamProject` above subscribes this layout to the
 * organization query, whose every `isFetching` flip re-rendered the layout —
 * and, through freshly-created child elements, the ENTIRE `<Outlet/>` subtree:
 * the page behind the panel, the dashboard, everything. Opening the Langy
 * panel triggers exactly such a refetch, so opening history paid two full-app
 * render passes (profiled at ~700ms each) for data that resolves to the same
 * `project.id`. The memo compares the two scalars that actually matter and
 * lets everything below bail out; navigation still flows, because the router
 * re-renders `<Outlet/>` through context, not through these props.
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
    <LangySidecar
      proposalHandlersRef={proposalHandlersRef}
      actionHandlersRef={actionHandlersRef}
    />
  );
}
