import { DashboardLayout } from "~/components/DashboardLayout";
import { EventSourcingContent } from "~/components/ops/event-sourcing/EventSourcingContent";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

export default function OpsEventSourcingPage() {
  return (
    <OpsPageShell>
      <DashboardLayout>
        <PageLayout.Header>
          <PageLayout.Heading>Event Sourcing</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Container>
          <EventSourcingContent />
        </PageLayout.Container>
      </DashboardLayout>
    </OpsPageShell>
  );
}
