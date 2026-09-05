/**
 * @see specs/features/agent-testing/case-version-history.feature
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
 */

import { Text } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import { useDrawer, useDrawerParams } from "@langwatch/ui-drawer";
import { ScenarioVersionList } from "./scenario-version-list";

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
          <Text fontWeight="semibold" fontSize="lg">
            Version history
          </Text>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <ScenarioVersionList scenarioId={scenarioId} markVersion={markVersion} />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
