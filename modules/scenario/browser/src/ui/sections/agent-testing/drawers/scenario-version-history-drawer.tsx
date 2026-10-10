/**
 * @see specs/features/agent-testing/case-version-history.feature
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
 */

import { useDrawer, useDrawerParams } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/studio-drawer";

import { ScenarioVersionList } from "./scenario-version-list.tsx";

export function ScenarioVersionHistoryDrawer({ open }: { open?: boolean }) {
  const { closeDrawer, goBack, canGoBack } = useDrawer();
  const params = useDrawerParams();
  const scenarioId = params.scenarioId ?? "";
  const markVersion = params.markVersion ? Number(params.markVersion) : null;

  const close = canGoBack ? goBack : closeDrawer;
  const isOpen = open !== false;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open: stillOpen }) => !stillOpen && close()}
      placement="end"
      size="md"
    >
      <Drawer.Content bg="bg" data-testid="scenario-version-history">
        <Drawer.Header>
          <Drawer.Title>Version history</Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <ScenarioVersionList scenarioId={scenarioId} markVersion={markVersion} />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
