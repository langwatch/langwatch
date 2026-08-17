import { EventSourcingLayout } from "~/components/ops/event-sourcing/EventSourcingLayout";
import { SchedulerContent } from "~/components/ops/scheduler/SchedulerContent";

export default function OpsSchedulesPage() {
  return (
    <EventSourcingLayout pageTitle="Schedules">
      <SchedulerContent />
    </EventSourcingLayout>
  );
}
