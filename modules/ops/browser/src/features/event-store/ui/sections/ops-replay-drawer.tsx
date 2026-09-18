import { Heading } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";

import { ReplayWizardContent } from "./replay-wizard-content.tsx";

/**
 * Projection replay as a drawer (URL-routed via `?replay=open`, so retired
 * /ops/projections links still land here). Status, start-a-replay and run
 * history stack top to bottom; per-run progress keeps /ops/projections/:runId.
 */
export function OpsReplayDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Drawer.Root open={true} placement="end" size="xl" onOpenChange={() => onClose()}>
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading size="md">Projection replay</Heading>
        </Drawer.Header>
        <Drawer.Body>
          <ReplayWizardContent />
        </Drawer.Body>
        <Drawer.CloseTrigger />
      </Drawer.Content>
    </Drawer.Root>
  );
}
