import { ReplayHistorySection as ReplayHistorySectionView } from "@langwatch/ops-web";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";
import NextLink from "~/utils/compat/next-link";

export function ReplayHistorySection() {
  const { openDrawer } = useDrawer();
  const historyQuery = api.ops.getReplayHistory.useQuery(undefined, {
    refetchInterval: 10000,
  });

  return (
    <ReplayHistorySectionView
      latestEntry={historyQuery.data?.[0]}
      onOpenReplay={() => openDrawer("opsReplay", {})}
      renderRunLink={(runId, content) => (
        <NextLink href={`/ops/projections/${runId}`} style={{ textDecoration: "none" }}>
          {content}
        </NextLink>
      )}
    />
  );
}
