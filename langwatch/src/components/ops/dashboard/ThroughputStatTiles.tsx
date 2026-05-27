import {
  formatCount,
  formatMs,
  formatRate,
} from "~/components/ops/shared/formatters";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { LinkedStat } from "./LinkedStat";

/** The subset of dashboard data the throughput stat strip reads. */
type ThroughputStatData = Pick<
  DashboardData,
  | "throughputIngestedPerSec"
  | "peakIngestedPerSec"
  | "completedPerSec"
  | "peakCompletedPerSec"
  | "totalCompleted"
  | "failedPerSec"
  | "totalFailed"
  | "totalGroups"
  | "latencyP50Ms"
  | "peakLatencyP50Ms"
  | "latencyP99Ms"
  | "peakLatencyP99Ms"
  | "queues"
>;

/**
 * The throughput / latency / backlog stat strip on the ops dashboard. Extracted
 * from OpsDashboardContent so the per-second tiles can be rendered in isolation
 * under test (mirrors RedisStatTiles). Returns a fragment of grid cells; the
 * parent SimpleGrid owns the layout.
 */
export function ThroughputStatTiles({ data }: { data: ThroughputStatData }) {
  const totalBlocked = data.queues.reduce(
    (sum, q) => sum + q.blockedGroupCount,
    0,
  );
  const totalDlq = data.queues.reduce((sum, q) => sum + q.dlqCount, 0);

  return (
    <>
      <LinkedStat
        label="Staged/s"
        value={formatRate(data.throughputIngestedPerSec)}
        sublabel={`peak ${formatRate(data.peakIngestedPerSec)}`}
      />
      <LinkedStat
        label="Completed/s"
        value={formatRate(data.completedPerSec)}
        sublabel={`peak ${formatRate(data.peakCompletedPerSec)} · ${formatCount(data.totalCompleted)} total`}
        testId="ops-completed-stat"
      />
      <LinkedStat
        label="Failed/s"
        value={formatRate(data.failedPerSec)}
        sublabel={
          data.totalFailed > 0
            ? `${formatCount(data.totalFailed)} total`
            : undefined
        }
        color={data.failedPerSec > 0 ? "red.500" : undefined}
      />
      <LinkedStat
        label="Blocked"
        value={totalBlocked.toString()}
        sublabel={`${data.totalGroups} groups`}
        color={totalBlocked > 0 ? "red.500" : undefined}
      />
      <LinkedStat
        label="P50"
        value={formatMs(data.latencyP50Ms)}
        sublabel={`peak ${formatMs(data.peakLatencyP50Ms)}`}
      />
      <LinkedStat
        label="P99"
        value={formatMs(data.latencyP99Ms)}
        sublabel={`peak ${formatMs(data.peakLatencyP99Ms)}`}
      />
      <LinkedStat
        label="DLQ"
        value={totalDlq.toString()}
        color={totalDlq > 0 ? "orange.500" : undefined}
      />
    </>
  );
}
