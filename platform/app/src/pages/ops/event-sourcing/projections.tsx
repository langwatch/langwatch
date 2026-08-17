import { Button, HStack, Spacer } from "@chakra-ui/react";
import { RotateCcw } from "lucide-react";
import { EventSourcingLayout } from "~/components/ops/event-sourcing/EventSourcingLayout";
import { ProjectionsCard } from "~/components/ops/event-sourcing/ProjectionsCard";
import { useDrawer } from "~/hooks/useDrawer";

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
      <ProjectionsCard />
    </EventSourcingLayout>
  );
}
