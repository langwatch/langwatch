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

  return (
    <HStack
      gap={1}
      align="stretch"
      overflowX="auto"
      data-testid="ops-stat-strip"
    >
      <ThroughputStats data={data} />
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
      <LatencyStats data={data} />
      <DeadLetterStat queueDead={totalDlq} outboxDead={outboxDead} />
      <RedisStatTile data={data} />
    </HStack>
  );
}

/** Rate tiles: what is arriving, finishing, and failing right now. */
function ThroughputStats({ data }: { data: DashboardData }) {
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
    </>
  );
}

/** Percentile tiles, both stating the sample they are measured over. */
function LatencyStats({ data }: { data: DashboardData }) {
  return (
    <>
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
    </>
  );
}

/**
 * Dead work across BOTH substrates, as one figure.
 *
 * The GroupQueue DLQ and the process-manager outbox retire work through
 * different machinery, and this tile used to count only the first — so it read
 * "0" on a page that had 94 dead outbox messages on it. An operator asking
 * "has anything stopped?" is not asking about a mechanism, so the headline is
 * the union and the sublabel says where it lives
 * (specs/ops/dead-letter-recovery.feature).
 */
function DeadLetterStat({
  queueDead,
  outboxDead,
}: {
  queueDead: number;
  outboxDead: number;
}) {
  const total = queueDead + outboxDead;
  return (
    <LinkedStat
      label="Dead letters"
      href="/ops/event-sourcing/dead-letters"
      value={formatCount(total)}
      sublabel={
        total > 0
          ? `${formatCount(queueDead)} queue · ${formatCount(outboxDead)} outbox`
          : undefined
      }
      color={total > 0 ? "red.500" : undefined}
    />
  );
}
