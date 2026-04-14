import { useEffect } from "react";
import { Spacer } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { QueuesContent } from "~/components/ops/queues";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useOpsPermission } from "~/hooks/useOpsPermission";

export default function OpsQueuesPage() {
  const router = useRouter();
  const { hasAccess, isLoading } = useOpsPermission();

  useEffect(() => {
    if (!isLoading && !hasAccess) void router.push("/");
  }, [hasAccess, isLoading, router]);

  if (isLoading || !hasAccess) return null;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Pipelines &amp; Queues</PageLayout.Heading>
        <Spacer />
      </PageLayout.Header>
      <PageLayout.Container>
        <QueuesContent />
      </PageLayout.Container>
    </DashboardLayout>
  );
}
