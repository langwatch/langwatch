import { VStack } from "@langwatch/design-system/primitives";

import { InsightSchedulesContent } from "../../../features/event-store/ui/sections/insight-schedules-panel.tsx";
import { SchedulerContent } from "../../../features/event-store/ui/sections/scheduler-panel.tsx";
import { UpcomingWorkCard } from "../../../features/event-store/ui/sections/upcoming-work-panel.tsx";
import { EventSourcingLayout } from "../../../ui/sections/event-sourcing-layout.tsx";

/** Upcoming work, then the report schedules, then each person's daily insights schedule. */
export default function OpsSchedulesScreen() {
  return (
    <EventSourcingLayout pageTitle="Schedules">
      <VStack align="stretch" gap={5}>
        <UpcomingWorkCard />
        <SchedulerContent />
        <InsightSchedulesContent />
      </VStack>
    </EventSourcingLayout>
  );
}
