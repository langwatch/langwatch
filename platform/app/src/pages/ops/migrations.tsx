import { DashboardLayout } from "~/components/DashboardLayout";
import { MigrationsContent } from "~/components/ops/migrations/MigrationsContent";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

export default function OpsMigrationsPage() {
  return (
    <OpsPageShell>
      <DashboardLayout>
        <PageLayout.Header>
          <PageLayout.Heading>Migrations</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Container>
          <MigrationsContent />
        </PageLayout.Container>
      </DashboardLayout>
    </OpsPageShell>
  );
}
