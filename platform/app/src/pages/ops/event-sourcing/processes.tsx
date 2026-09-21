import { EventSourcingLayout } from "~/components/ops/event-sourcing/EventSourcingLayout";
import { ProcessesContent } from "~/components/ops/processes/ProcessesContent";

export default function OpsProcessesPage() {
  return (
    <EventSourcingLayout pageTitle="Processes">
      <ProcessesContent />
    </EventSourcingLayout>
  );
}
