import { Link as RoutedLink } from "@langwatch/browser-host/link";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsOverlay } from "../../../../behavior/ops-overlays.ts";
import { ReplayHistorySection as ReplayHistorySectionView } from "../blocks/replay-history-section.tsx";

export function ReplayHistorySection() {
  const replay = useOpsOverlay("replay");
  const historyQuery = api.ops.getReplayHistory.useQuery(undefined, {
    refetchInterval: 10000,
  });

  return (
    <ReplayHistorySectionView
      latestEntry={historyQuery.data?.[0]}
      onOpenReplay={() => replay.open("open")}
      renderRunLink={(runId, content) => (
        <RoutedLink href={`/ops/projections/${runId}`} style={{ textDecoration: "none" }}>
          {content}
        </RoutedLink>
      )}
    />
  );
}
