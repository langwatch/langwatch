import { HStack } from "@chakra-ui/react";
import {
  formatCount,
  formatMs,
  formatRate,
} from "~/components/ops/shared/formatters";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { LATENCY_SAMPLE_SIZE } from "~/shared/ops/latency";
import { api } from "~/utils/api";
import { LinkedStat } from "./LinkedStat";
import { RedisStatTile } from "./RedisStatTile";

/**
 * What the percentile tiles are measured over. A sample count, deliberately
 * not a time window: at high throughput the sample spans under a second, on a
 * quiet queue it can span hours, and pretending either is "the last 5 minutes"
 * would be wrong in both directions.
 */
const LATENCY_BASIS = `Processing time across each queue's last ${LATENCY_SAMPLE_SIZE} completed jobs — a rolling sample, not a time window.`;

/**
 * The headline figures, on ONE row.
 *
 * This was a ten-column grid holding eleven tiles, so the eleventh orphaned
 * onto a second row and cost a full row of whitespace. Redis is one tile
 * carrying three figures, because an operator reads memory, processor and
 * connections together or not at all.
 */
export function StatStrip({ data }: { data: DashboardData }) {
  const totalBlocked = data.queues.reduce(
    (sum, q) => sum + q.blockedGroupCount,
    0,
  );
  const totalParked = data.queues.reduce(
    (sum, q) => sum + q.parkedGroupCount,
    0,
  );
  const totalDlq = data.queues.reduce((sum, q) => sum + q.dlqCount, 0);
  // The other dead-letter substrate. The queue figure alone once read "0"
  // while 94 process-outbox messages sat dead further down the page — the
  // headline number must be the union or it lies
  // (specs/ops/dead-letter-recovery.feature). Same source the navigation
  // badge and the DLQ card poll, so the figures can never disagree.
  const outboxDeadQuery = api.ops.listDeadLetterCounts.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const outboxDead = (outboxDeadQuery.data ?? []).reduce(
    (sum, row) => sum + row.count,
    0,
  );
  const totalDead = totalDlq + outboxDead;

  return (
    <HStack
      gap={1}
      align="stretch"
      overflowX="auto"
      data-testid="ops-stat-strip"
    >
      <LinkedStat
        label="Staged/s"
        value={formatRate(data.throughputIngestedPerSec)}
        sublabel={`peak ${formatRate(data.peakIngestedPerSec)}`}
      />
      <LinkedStat
        label="Completed/s"
        value={formatRate(data.completedPerSec)}
        sublabel={`peak ${formatRate(data.peakCompletedPerSec)} · ${formatCount(
          data.totalCompleted,
        )} total`}
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
        value={formatCount(totalBlocked)}
        sublabel={`${formatCount(data.totalGroups)} groups`}
        color={totalBlocked > 0 ? "red.500" : undefined}
      />
      <LinkedStat
        label="Parked"
        value={formatCount(totalParked)}
        // Says what it MEANS, not just what it counts: parked is a capacity
        // limit doing its job, and an unexplained orange six-figure number
        // reads as an outage to whoever is on call.
        sublabel={totalParked > 0 ? "at capacity limit" : "none at limit"}
        color={totalParked > 0 ? "orange.500" : undefined}
      />
      <LinkedStat
        label="P50"
        value={formatMs(data.latencyP50Ms)}
        sublabel={`peak ${formatMs(data.peakLatencyP50Ms)} · last ${LATENCY_SAMPLE_SIZE} jobs`}
        hint={LATENCY_BASIS}
      />
      <LinkedStat
        label="P99"
        value={formatMs(data.latencyP99Ms)}
        sublabel={`peak ${formatMs(data.peakLatencyP99Ms)} · last ${LATENCY_SAMPLE_SIZE} jobs`}
        hint={LATENCY_BASIS}
      />
      <LinkedStat
        label="Dead letters"
        href="/ops/event-sourcing/dead-letters"
        value={formatCount(totalDead)}
        sublabel={
          totalDead > 0
            ? `${formatCount(totalDlq)} queue · ${formatCount(outboxDead)} outbox`
            : undefined
        }
        color={totalDead > 0 ? "red.500" : undefined}
      />
      <RedisStatTile data={data} />
    </HStack>
  );
}
