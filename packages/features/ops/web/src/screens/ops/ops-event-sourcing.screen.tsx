import { EventSourcingLayout } from "../../ui/sections/event-sourcing-layout";
import { EventSourcingOverview } from "../../features/event-store/ui/sections/event-sourcing-overview";

export default function OpsEventSourcingScreen() {
  return (
    <EventSourcingLayout pageTitle="Event Sourcing">
      <EventSourcingOverview />
    </EventSourcingLayout>
  );
}
