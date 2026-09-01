import { Button, Center, EmptyState, Spacer, Spinner } from "@chakra-ui/react";
import { Database } from "lucide-react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { useOpsOverlay } from "../../behavior/ops-overlays";
import { api } from "../../behavior/ops-api";
import { OpsBlobsDrawer } from "../../features/blob-store/ui/sections/ops-blobs-drawer";
import { ConnectionStatusIndicator } from "../../features/event-store/ui/elements/connection-status-indicator";
import { OpsDashboardContent } from "../../features/event-store/ui/sections/ops-dashboard-content";

/**
 * The Ops landing page.
 *
 * WHAT CHANGED IN THE MOVE, and it is the one live-data loss of this family:
 * the dashboard used to hold a tRPC SUBSCRIPTION (`ops.dashboardStream`) and
 * fall back to a five-second poll of `ops.getDashboardSnapshot` when the socket
 * was not up. `apps/ui`'s transport declares no subscriptions — the host routes
 * those over a WebSocket it configures from its own environment — so the page
 * now always takes the fallback. The numbers are the same numbers; they arrive
 * on a poll rather than a push, and the connection indicator says "polling"
 * rather than claiming a socket it does not have.
 */
export default function OpsDashboardScreen() {
  const payloadStore = useOpsOverlay("payloadStore");
  const snapshot = api.ops.getDashboardSnapshot.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const data = snapshot.data ?? null;

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Ops Dashboard</PageLayout.Heading>
        <Spacer />
        <Button size="xs" variant="outline" onClick={() => payloadStore.open("open")}>
          <Database size={12} /> Payload store
        </Button>
        {/* The snapshot's own age, not just the poll's health: this page can be
            reading numbers no writer has refreshed. */}
        <ConnectionStatusIndicator
          status={
            snapshot.isError ? "disconnected" : snapshot.isSuccess ? "connected" : "connecting"
          }
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
      {payloadStore.value !== null && <OpsBlobsDrawer onClose={payloadStore.close} />}
    </>
  );
}
