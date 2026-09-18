import { DeadLettersContent } from "../../../features/event-store/ui/sections/dead-letters-content.tsx";
import { EventSourcingLayout } from "../../../ui/sections/event-sourcing-layout.tsx";

export default function OpsDeadLettersScreen() {
  return (
    <EventSourcingLayout pageTitle="Dead Letters">
      <DeadLettersContent />
    </EventSourcingLayout>
  );
}
