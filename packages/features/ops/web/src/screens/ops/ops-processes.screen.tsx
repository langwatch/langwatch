import { EventSourcingLayout } from "../../ui/sections/event-sourcing-layout.tsx";
import { ProcessesContent } from "../../features/event-store/ui/sections/processes-content.tsx";

export default function OpsProcessesScreen() {
  return (
    <EventSourcingLayout pageTitle="Processes">
      <ProcessesContent />
    </EventSourcingLayout>
  );
}
