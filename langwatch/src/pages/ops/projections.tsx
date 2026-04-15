import { DashboardLayout } from "~/components/DashboardLayout";
import { ReplayWizardContent } from "~/components/ops/projections";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

export default function OpsProjectionsPage() {
  return (
    <OpsPageShell>
      <DashboardLayout>
        <PageLayout.Header>
          <PageLayout.Heading>Projection Replay</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Container>
          <ReplayWizardContent />
        </PageLayout.Container>
      </DashboardLayout>
    </OpsPageShell>
  );
}
