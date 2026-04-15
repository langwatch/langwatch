import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { ReplayProgressContent } from "~/components/ops/replay-progress";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

export default function ReplayProgressPage() {
  const router = useRouter();
  const runId = router.query.runId as string;

  return (
    <OpsPageShell>
      <DashboardLayout>
        <PageLayout.Header>
          <PageLayout.Heading>Replay Progress</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Container>
          <ReplayProgressContent runId={runId} />
        </PageLayout.Container>
      </DashboardLayout>
    </OpsPageShell>
  );
}
