import { PageLayout } from "@langwatch/design-system/page-layout";
import { Skeleton, Spacer, VStack } from "@langwatch/design-system/primitives";
import { Database } from "lucide-react";

import { api } from "../../../behavior/ops-api.ts";
import { useOpsOverlay } from "../../../behavior/ops-overlays.ts";
import { OpsBlobsDrawer } from "../../../features/blob-store/ui/sections/ops-blobs-drawer.tsx";
import { ConnectionStatusIndicator } from "../../../features/event-store/ui/elements/connection-status-indicator.tsx";
import { OpsDashboardContent } from "../../../features/event-store/ui/sections/ops-dashboard-content.tsx";
import { HandledErrorAlert } from "../../elements/ops-handled-error-alert.tsx";

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
  const snapshot = api.ops.getDashboardSnapshot.useQuery(undefined, {
  });

  const data = snapshot.data ?? null;

  const connectionStatus = describeSnapshotConnection(snapshot);

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Ops Dashboard</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton onClick={() => payloadStore.open("open")}>
          <Database size={16} /> Payload store
        </PageLayout.HeaderButton>
        {/* The snapshot's own age, not just the poll's health: this page can be
            reading numbers no writer has refreshed. */}
        <ConnectionStatusIndicator
          status={connectionStatus}
          computedAtMs={data?.snapshot.computedAt ?? null}
        />
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
            <Skeleton height="96px" />
            <Skeleton height="240px" />
          </VStack>
        )}
      </PageLayout.Container>
      {payloadStore.value !== null && <OpsBlobsDrawer onClose={payloadStore.close} />}
    </>
  );
}
