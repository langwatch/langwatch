import { EventSourcingLayout } from "~/components/ops/event-sourcing/EventSourcingLayout";
import { EventSourcingOverview } from "~/components/ops/event-sourcing/EventSourcingOverview";

export default function OpsEventSourcingPage() {
  return (
    <EventSourcingLayout pageTitle="Event Sourcing">
      <EventSourcingOverview />
    </EventSourcingLayout>
  );
}
