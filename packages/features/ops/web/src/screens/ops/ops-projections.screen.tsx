import { Button, HStack, Spacer, VStack } from "@chakra-ui/react";
import { RotateCcw } from "lucide-react";
import { useOpsOverlay } from "../../behavior/ops-overlays";
import { EventSourcingLayout } from "../../ui/sections/event-sourcing-layout";
import { OpsReplayDrawer } from "../../features/event-store/ui/sections/ops-replay-drawer";
import { ProjectionsCard } from "../../features/event-store/ui/sections/projections-panel";
import { ReplayHistorySection } from "../../features/event-store/ui/sections/replay-history-panel";

/**
 * The projections, and the replays that rebuild them.
 *
 * Replay history moved here from the dashboard, where it was the last card on a
 * long page and a floor below the button that starts a replay. Both controls now
 * sit with the projections they act on, so "what did the last replay do" and
 * "run another" are the same glance.
 *
 * The replay wizard is a drawer addressed by this page's own `?replay=open`
 * rather than by the application drawer registry — the answer the gateway family
 * reached for its routing-policy editor, and the reason the registry entry could
 * be deleted rather than copied.
 */
export default function OpsProjectionsScreen() {
  const replay = useOpsOverlay("replay");
  return (
    <EventSourcingLayout pageTitle="Projections">
      <HStack marginBottom={3}>
        <Spacer />
        <Button size="xs" variant="outline" onClick={() => replay.open("open")}>
          <RotateCcw size={12} />
          Replay projections
        </Button>
      </HStack>
      <VStack align="stretch" gap={5}>
        <ReplayHistorySection />
        <ProjectionsCard />
      </VStack>
      {replay.value !== null && <OpsReplayDrawer onClose={replay.close} />}
    </EventSourcingLayout>
  );
}
