import { EventSourcingLayout } from "../../ui/sections/event-sourcing-layout";
import { ProcessesContent } from "../../features/event-store/ui/sections/processes-content";

export default function OpsProcessesScreen() {
  return (
    <EventSourcingLayout pageTitle="Processes">
      <ProcessesContent />
    </EventSourcingLayout>
  );
}
