import { Button, Center, EmptyState, Spacer, Spinner } from "@chakra-ui/react";
import { Database } from "lucide-react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { OpsDashboardContent } from "~/components/ops/dashboard";
import { ConnectionStatusIndicator } from "~/components/ops/shared/ConnectionStatusIndicator";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useDrawer } from "~/hooks/useDrawer";
import { useOpsSSE } from "~/hooks/useOpsSSE";
import { api } from "~/utils/api";

export default function OpsPage() {
  const { data: sseData, status } = useOpsSSE();
  const { openDrawer } = useDrawer();
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
          <Button
            size="xs"
            variant="outline"
            onClick={() => openDrawer("opsBlobs", {})}
          >
            <Database size={12} /> Payload store
          </Button>
          {/* The snapshot's own age, not just the socket's health: this page
              can hold a live connection to a pod that is serving numbers no
              writer has refreshed. */}
          <ConnectionStatusIndicator
            status={status}
            computedAtMs={data?.snapshot.computedAt ?? null}
          />
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
