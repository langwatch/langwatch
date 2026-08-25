import { Heading } from "@chakra-ui/react";
import { Drawer } from "~/components/ui/drawer";
import { useDrawer } from "~/hooks/useDrawer";
import { ReplayWizardContent } from "./ReplayWizardContent";

/**
 * Projection replay as a drawer (URL-routed via `drawer.open=opsReplay`, so
 * the old /ops/projections links still land here). The running-replay status,
 * the start-a-replay flow, and the run history stack top to bottom; per-run
 * progress keeps its own page at /ops/projections/:runId for deep links.
 */
export function OpsReplayDrawer() {
  const { closeDrawer } = useDrawer();
  return (
    <Drawer.Root open={true} placement="end" size="xl" onOpenChange={() => closeDrawer()}>
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
