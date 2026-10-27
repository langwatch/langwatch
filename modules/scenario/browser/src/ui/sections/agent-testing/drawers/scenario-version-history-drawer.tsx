/**
 * @see specs/features/agent-testing/case-version-history.feature
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
 */

import { useDrawer, useDrawerParams } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";

import { ScenarioVersionList } from "./scenario-version-list.tsx";

export function ScenarioVersionHistoryDrawer({ open }: { open?: boolean }) {
  const { closeDrawer, goBack, canGoBack } = useDrawer();
  const params = useDrawerParams();
  const scenarioId = params.scenarioId ?? "";
  const markVersion = params.markVersion ? Number(params.markVersion) : null;

  const close = canGoBack ? goBack : closeDrawer;
  const isOpen = open !== false;

  return (
    <Drawer
      open={isOpen}
      onClose={close}
      size="md"
      title="Version history"
      data-testid="scenario-version-history"
    >
      <ScenarioVersionList scenarioId={scenarioId} markVersion={markVersion} />
    </Drawer>
  );
}
