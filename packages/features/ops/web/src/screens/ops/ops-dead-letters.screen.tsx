import { EventSourcingLayout } from "../../ui/sections/event-sourcing-layout";
import { DeadLettersContent } from "../../features/event-store/ui/sections/dead-letters-content";

export default function OpsDeadLettersScreen() {
  return (
    <EventSourcingLayout pageTitle="Dead Letters">
      <DeadLettersContent />
    </EventSourcingLayout>
  );
}
