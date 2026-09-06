import { DashboardLayout } from "~/components/DashboardLayout";
import { FeatureFlagsContent } from "~/components/ops/featureFlags/FeatureFlagsContent";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

export default function OpsFeatureFlagsPage() {
  return (
    <OpsPageShell>
      <DashboardLayout>
        <PageLayout.Header>
          <PageLayout.Heading>Feature Flags</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Container>
          <FeatureFlagsContent />
        </PageLayout.Container>
      </DashboardLayout>
    </OpsPageShell>
  );
}
