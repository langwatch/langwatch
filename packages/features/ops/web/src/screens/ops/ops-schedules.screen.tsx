import { VStack } from "@chakra-ui/react";
import { EventSourcingLayout } from "../../ui/sections/event-sourcing-layout";
import { SchedulerContent } from "../../features/event-store/ui/sections/scheduler-panel";
import { UpcomingWorkCard } from "../../features/event-store/ui/sections/upcoming-work-panel";

/**
 * The calendar, and what it is about to do.
 *
 * Upcoming work sits above the schedules rather than on the dashboard: it is a
 * preview of these rows plus the process wakes due alongside them, and on the
 * landing page it was a table of things that are fine — the opposite of what
 * that page is for. It stays outside `SchedulerContent` because that component
 * returns early when no job is scheduled, and process wakes are due whether or
 * not the calendar has anything on it.
 */
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
