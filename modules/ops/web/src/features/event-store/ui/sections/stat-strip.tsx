import { HStack } from "@chakra-ui/react";
import { LATENCY_SAMPLE_SIZE, type DashboardData } from "@langwatch/ops-contract";
import { RedisStatTile } from "../elements/redis-stat-tile.tsx";
import { formatCount, formatMs, formatRate } from "../../../../model/ops-formatters.ts";
import { api } from "../../../../behavior/ops-api.ts";
import { LinkedStat } from "../elements/linked-stat.tsx";

/** Percentiles measured over sample count (rolling, not time window); width varies
 * with throughput. */
const LATENCY_BASIS = `Processing time across each queue's last ${LATENCY_SAMPLE_SIZE} completed jobs (a rolling sample, not a time window).`;

/** Headline figures on ONE row. Redis as one tile (three figures read together);
 * avoids orphaning eleventh tile. */
export function StatStrip({ data }: { data: DashboardData }) {
  const totalBlocked = data.queues.reduce((sum, q) => sum + q.blockedGroupCount, 0);
  const totalParked = data.queues.reduce((sum, q) => sum + q.parkedGroupCount, 0);
  const totalDlq = data.queues.reduce((sum, q) => sum + q.dlqCount, 0);
  // The other dead-letter substrate. The queue figure alone once read "0"
  // while 94 process-outbox messages sat dead further down the page — the
  // headline number must be the union or it lies
  // (specs/ops/dead-letter-recovery.feature). Same source the navigation
  // badge and the DLQ card poll, so the figures can never disagree.
  const outboxDeadQuery = api.ops.listDeadLetterCounts.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const outboxDead = (outboxDeadQuery.data ?? []).reduce((sum, row) => sum + row.count, 0);

  return (
    <HStack gap={1} align="stretch" overflowX="auto" data-testid="ops-stat-strip">
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
      <DeadLetterStat
        queueDead={totalDlq}
        outboxDead={outboxDead}
        isOutboxCountKnown={outboxDeadQuery.data !== undefined}
      />
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
        sublabel={data.totalFailed > 0 ? `${formatCount(data.totalFailed)} total` : undefined}
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

/** Dead work from BOTH substrates (queue DLQ + outbox); headline is union, sublabel
 * names source. */
function DeadLetterStat({
  queueDead,
  outboxDead,
  isOutboxCountKnown,
}: {
  queueDead: number;
  outboxDead: number;
  isOutboxCountKnown: boolean;
}) {
  // Half the union is not the union. Until the outbox answer lands, showing
  // the queue figure alone would state a total that is wrong, then jump and
  // turn red when the rest arrives — which on an ops surface reads as a new
  // incident rather than as the tile finishing loading. An unknown says so.
  if (!isOutboxCountKnown) {
    return (
      <LinkedStat
        label="Dead letters"
        value="—"
        sublabel="counting"
        testId="ops-dead-letters-stat"
      />
    );
  }
  const total = queueDead + outboxDead;
  return (
    <LinkedStat
      label="Dead letters"
      testId="ops-dead-letters-stat"
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
