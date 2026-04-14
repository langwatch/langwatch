import { useEffect } from "react";
import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { ReplayWizardContent } from "~/components/ops/projections";

export default function OpsProjectionsPage() {
  const router = useRouter();
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
        <PageLayout.Heading>Projection Replay</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
        <ReplayWizardContent />
      </PageLayout.Container>
    </DashboardLayout>
  );
}
