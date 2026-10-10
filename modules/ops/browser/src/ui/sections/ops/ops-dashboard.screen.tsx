import { PageLayout } from "@langwatch/design-system/page-layout";
import { Skeleton, VStack } from "@langwatch/design-system/primitives";
import { StatTileSkeleton } from "@langwatch/design-system/stat-tile";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Database } from "lucide-react";

import { api } from "../../../behavior/ops-api.ts";
import { useOpsOverlay } from "../../../behavior/ops-overlays.ts";
import { OpsBlobsDrawer } from "../../../features/blob-store/ui/sections/ops-blobs-drawer.tsx";
import { ConnectionStatusIndicator } from "../../../features/event-store/ui/elements/connection-status-indicator.tsx";
import { OpsDashboardContent } from "../../../features/event-store/ui/sections/ops-dashboard-content.tsx";

/** Whether the page is reading a live snapshot, still waiting, or cut off. */
function describeSnapshotConnection({
  isError,
  isSuccess,
}: {
  isError: boolean;
  isSuccess: boolean;
}) {
  if (isError) return "disconnected";
  return isSuccess ? "connected" : "connecting";
}

/** Ops landing page; always polls (subscriptions routed at host level). */
export default function OpsDashboardScreen() {
  const payloadStore = useOpsOverlay("payloadStore");
  const snapshot = api.ops.getDashboardSnapshot.useQuery(undefined, {});

  const data = snapshot.data ?? null;

  const connectionStatus = describeSnapshotConnection(snapshot);

  return (
    <>
      <PageLayout.Header
        flexWrap="wrap"
        actions={
          <>
            <ConnectionStatusIndicator
              status={connectionStatus}
              computedAtMs={data?.snapshot.computedAt ?? null}
            />
            <PageLayout.HeaderButton onClick={() => payloadStore.open("open")}>
              <Database size={16} aria-hidden /> Payload store
            </PageLayout.HeaderButton>
          </>
        }
      >
        <VStack align="start" gap={1} minWidth={0}>
          <PageLayout.Heading>Ops Dashboard</PageLayout.Heading>
          <PageLayout.Subtitle>
            Throughput, queue health, and work that needs attention.
          </PageLayout.Subtitle>
        </VStack>
      </PageLayout.Header>
      <PageLayout.Container>
        {data && <OpsDashboardContent data={data} />}
        {!data && snapshot.isError && (
          <HandledErrorAlert
            error={snapshot.error}
            fallbackTitle="The ops dashboard could not load"
          />
        )}
        {!data && !snapshot.isError && (
          <VStack gap={3} align="stretch" aria-label="Loading metrics">
            <StatTileSkeleton columns={3} />
            <Skeleton height="240px" />
          </VStack>
        )}
      </PageLayout.Container>
      {payloadStore.value !== null && <OpsBlobsDrawer onClose={payloadStore.close} />}
    </>
  );
}
