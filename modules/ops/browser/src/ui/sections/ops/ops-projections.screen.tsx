import { Button, HStack, Spacer, VStack } from "@chakra-ui/react";
import { RotateCcw } from "lucide-react";

import { useOpsOverlay } from "../../../behavior/ops-overlays.ts";
import { OpsReplayDrawer } from "../../../features/event-store/ui/sections/ops-replay-drawer.tsx";
import { ProjectionsCard } from "../../../features/event-store/ui/sections/projections-panel.tsx";
import { ReplayHistorySection } from "../../../features/event-store/ui/sections/replay-history-panel.tsx";
import { EventSourcingLayout } from "../../../ui/sections/event-sourcing-layout.tsx";

/** Projections and replays that rebuild them; wizard addressed by page query. */
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
