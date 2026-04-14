import { useEffect } from "react";
import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { ReplayProgressContent } from "~/components/ops/replay-progress";

export default function ReplayProgressPage() {
  const router = useRouter();
  const runId = router.query.runId as string;

  const { hasAccess, isLoading: opsLoading } = useOpsPermission();

  useEffect(() => {
    if (!opsLoading && !hasAccess) {
      void router.push("/");
    }
  }, [hasAccess, opsLoading, router]);

  if (opsLoading || !hasAccess) return null;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Replay Progress</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
        <ReplayProgressContent runId={runId} />
      </PageLayout.Container>
    </DashboardLayout>
  );
}
