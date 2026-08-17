import { Button, HStack, Spacer, VStack } from "@chakra-ui/react";
import { RotateCcw } from "lucide-react";
import { EventSourcingLayout } from "~/components/ops/event-sourcing/EventSourcingLayout";
import { ProjectionsCard } from "~/components/ops/event-sourcing/ProjectionsCard";
import { ReplayHistorySection } from "~/components/ops/event-sourcing/ReplayHistorySection";
import { useDrawer } from "~/hooks/useDrawer";

/**
 * The projections, and the replays that rebuild them.
 *
 * Replay history moved here from the dashboard, where it was the last card on
 * a long page and a floor below the button that starts a replay. Both controls
 * now sit with the projections they act on, so "what did the last replay do"
 * and "run another" are the same glance.
 */
export default function OpsProjectionsSectionPage() {
  const { openDrawer } = useDrawer();
  return (
    <EventSourcingLayout pageTitle="Projections">
      <HStack marginBottom={3}>
        <Spacer />
        <Button
          size="xs"
          variant="outline"
          onClick={() => openDrawer("opsReplay", {})}
        >
          <RotateCcw size={12} />
          Replay projections
        </Button>
      </HStack>
      <VStack align="stretch" gap={5}>
        <ReplayHistorySection />
        <ProjectionsCard />
      </VStack>
    </EventSourcingLayout>
  );
}
