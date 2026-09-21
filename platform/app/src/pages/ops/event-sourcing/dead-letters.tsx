import { DeadLettersContent } from "~/components/ops/deadLetters/DeadLettersContent";
import { EventSourcingLayout } from "~/components/ops/event-sourcing/EventSourcingLayout";

export default function OpsDeadLettersPage() {
  return (
    <EventSourcingLayout pageTitle="Dead Letters">
      <DeadLettersContent />
    </EventSourcingLayout>
  );
}
