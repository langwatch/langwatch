import { EventSourcingLayout } from "~/components/ops/event-sourcing/EventSourcingLayout";
import { SubscribersCard } from "~/components/ops/processes/SubscribersCard";

export default function OpsSubscribersPage() {
  return (
    <EventSourcingLayout pageTitle="Event Subscribers">
      <SubscribersCard />
    </EventSourcingLayout>
  );
}
