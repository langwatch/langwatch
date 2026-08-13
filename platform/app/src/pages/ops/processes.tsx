import { DashboardLayout } from "~/components/DashboardLayout";
import { ProcessesContent } from "~/components/ops/processes/ProcessesContent";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

export default function OpsProcessesPage() {
  return (
    <OpsPageShell>
      <DashboardLayout>
        <PageLayout.Header>
          <PageLayout.Heading>Processes</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Container>
          <ProcessesContent />
        </PageLayout.Container>
      </DashboardLayout>
    </OpsPageShell>
  );
}
