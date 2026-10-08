import { LangyMarkGradientDefs } from "@langwatch/design-system/langy-mark";
import { NOT_TARGETED } from "@langwatch/feature-flag-contract";
import { lazy, Suspense, useState } from "react";

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { useFeatureFlag } from "../../../../behavior/use-feature-flag.ts";
import { useGlobalLangyShortcut } from "../../../../behavior/use-global-langy-shortcut.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { LangyLauncher } from "./langy-launcher.tsx";
import type { LangySidecarProps } from "./langy-panel.tsx";

// The panel (chat engine, cards, markdown, charts) is most of Langy's weight, so a page
// loads it when Langy opens, not on every visit.
const LangySidecar = lazy(() =>
  import("./langy-panel.tsx").then((module) => ({ default: module.LangySidecar })),
);

/**
 * Langy on a project page: the launcher and shortcut until Langy is first wanted, then the
 * panel, which stays mounted once loaded so a closed panel keeps its in-flight turn. With the
 * peek dock on, the closed panel is itself the affordance, so it loads at once.
 */
export function LangyDock(props: LangySidecarProps) {
  const isOpen = useLangyStore((s) => s.isOpen);
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const peekDock = useFeatureFlag("release_ui_langy_peek_dock_enabled", {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organization?.id ?? NOT_TARGETED,
  });
  const [wanted, setWanted] = useState(false);
  if (!wanted && (isOpen || peekDock.enabled)) setWanted(true);

  if (!wanted) return <LangyClosedDock isOpen={isOpen} />;
  return (
    <Suspense fallback={<LangyClosedDock isOpen={isOpen} />}>
      <LangySidecar {...props} />
    </Suspense>
  );
}

/** The closed launcher and the open shortcut, as the panel draws them, without the panel. */
function LangyClosedDock({ isOpen }: { isOpen: boolean }) {
  const toggle = useLangyStore((s) => s.togglePanel);
  useGlobalLangyShortcut(toggle);
  return (
    <>
      <LangyMarkGradientDefs />
      <LangyLauncher isOpen={isOpen} onOpen={toggle} />
    </>
  );
}
