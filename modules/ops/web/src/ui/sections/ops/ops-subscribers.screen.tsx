import { EventSourcingLayout } from "../../../ui/sections/event-sourcing-layout.tsx";
import { SubscribersCard } from "../../../features/event-store/ui/sections/subscribers-panel.tsx";

export default function OpsSubscribersScreen() {
  return (
    <EventSourcingLayout pageTitle="Event Subscribers">
      <SubscribersCard />
    </EventSourcingLayout>
  );
}
