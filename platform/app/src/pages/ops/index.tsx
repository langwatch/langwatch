import { Center, EmptyState, Spacer, Spinner } from "@chakra-ui/react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { OpsDashboardContent } from "~/components/ops/dashboard";
import { ConnectionStatusIndicator } from "~/components/ops/shared/ConnectionStatusIndicator";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useOpsSSE } from "~/hooks/useOpsSSE";
import { api } from "~/utils/api";

export default function OpsPage() {
  const { data: sseData, status } = useOpsSSE();
  const snapshot = api.ops.getDashboardSnapshot.useQuery(undefined, {
    enabled: !sseData,
    refetchInterval: sseData ? false : 5000,
  });

  const data = sseData ?? snapshot.data ?? null;

  return (
    <OpsPageShell>
      <DashboardLayout>
        <PageLayout.Header>
          <PageLayout.Heading>Ops Dashboard</PageLayout.Heading>
          <Spacer />
          <ConnectionStatusIndicator status={status} />
        </PageLayout.Header>
        <PageLayout.Container>
          {data ? (
            <OpsDashboardContent data={data} />
          ) : (
            <Center paddingY={20}>
              <EmptyState.Root>
                <EmptyState.Content>
                  <EmptyState.Indicator>
                    <Spinner size="lg" />
                  </EmptyState.Indicator>
                  <EmptyState.Title>Loading metrics</EmptyState.Title>
                  <EmptyState.Description>
                    Waiting for the first collection cycle...
                  </EmptyState.Description>
                </EmptyState.Content>
              </EmptyState.Root>
            </Center>
          )}
        </PageLayout.Container>
      </DashboardLayout>
    </OpsPageShell>
  );
}
