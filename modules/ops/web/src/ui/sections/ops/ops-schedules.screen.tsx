import { VStack } from "@chakra-ui/react";
import { EventSourcingLayout } from "../../../ui/sections/event-sourcing-layout.tsx";
import { SchedulerContent } from "../../../features/event-store/ui/sections/scheduler-panel.tsx";
import { UpcomingWorkCard } from "../../../features/event-store/ui/sections/upcoming-work-panel.tsx";

/** Calendar and upcoming work; above schedules, separate from SchedulerContent. */
export default function OpsSchedulesScreen() {
  return (
    <EventSourcingLayout pageTitle="Schedules">
      <VStack align="stretch" gap={5}>
        <UpcomingWorkCard />
        <SchedulerContent />
      </VStack>
    </EventSourcingLayout>
  );
}
