import { ReplayHistorySection as ReplayHistorySectionView } from "../blocks/replay-history-section";
import { useOpsOverlay } from "../../../../behavior/ops-overlays";
import { api } from "../../../../behavior/ops-api";
import { OpsNextLink as NextLink } from "../../../../ui/elements/ops-link";

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
        <NextLink href={`/ops/projections/${runId}`} style={{ textDecoration: "none" }}>
          {content}
        </NextLink>
      )}
    />
  );
}
