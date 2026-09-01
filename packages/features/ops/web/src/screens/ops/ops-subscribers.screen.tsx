import { EventSourcingLayout } from "../../ui/sections/event-sourcing-layout";
import { SubscribersCard } from "../../features/event-store/ui/sections/subscribers-panel";

export default function OpsSubscribersScreen() {
  return (
    <EventSourcingLayout pageTitle="Event Subscribers">
      <SubscribersCard />
    </EventSourcingLayout>
  );
}
