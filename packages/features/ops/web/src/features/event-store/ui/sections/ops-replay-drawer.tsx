import { Heading } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { ReplayWizardContent } from "./replay-wizard-content";

/**
 * Projection replay as a drawer (URL-routed via the projections page's own `?replay=open`, so
 * the retired /ops/projections links still land here). The running-replay status,
 * the start-a-replay flow, and the run history stack top to bottom; per-run
 * progress keeps its own page at /ops/projections/:runId for deep links.
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
