import { EventSourcingLayout } from "../../ui/sections/event-sourcing-layout.tsx";
import { EventSourcingOverview } from "../../features/event-store/ui/sections/event-sourcing-overview.tsx";

export default function OpsEventSourcingScreen() {
  return (
    <EventSourcingLayout pageTitle="Event Sourcing">
      <EventSourcingOverview />
    </EventSourcingLayout>
  );
}
