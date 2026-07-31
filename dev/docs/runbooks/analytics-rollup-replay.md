# Analytics rollup replay after the Replicated-engine conversion

> **Why this exists**: migrations 00065 and 00066 convert
> `trace_analytics_rollup` and `evaluation_analytics_rollup` from plain
> `AggregatingMergeTree` to the Replicated engine. On clustered deployments
> (`CLICKHOUSE_CLUSTER` set) the old per-replica content is unusable as a
> rebuild source (each replica held a private fraction), so both tables come
> out of the migration EMPTY there and history must be rebuilt by the
> event-sourcing replay. On single-node deployments the migration carries the
> data over and none of this runbook is needed.

## What rebuilds what

| Table | Rebuilt by | Source |
|---|---|---|
| `gateway_budget_scope_totals` | migration 00064 itself | `gateway_budget_ledger_events` (replicated), no operator action |
| `trace_analytics_rollup` | replay of projection `traceAnalyticsRollup` | `SpanReceivedEvent`s in `event_log` (replicated) |
| `evaluation_analytics_rollup` | replay of projection `evaluationAnalyticsRollup` | terminal evaluation events in `event_log` (replicated) |

The rollup rows are produced by TypeScript map projections
(`traceAnalyticsRollup.mapProjection.ts`,
`evaluationAnalyticsRollup.mapProjection.ts`): span normalization, canonical
model extraction, token-accumulation gating and pricing. That logic has no SQL
equivalent, which is why the migration cannot rebuild these two tables the way
00064 rebuilds the budget rollup. Replay-path fidelity is covered by
`src/server/event-sourcing/replay/__tests__/replay-projection-parity.integration.test.ts`.

## When to run

Once, after a deploy containing 00065/00066 lands on a clustered deployment.
There is no urgency window for correctness: new increments replicate correctly
from the moment the migration swaps the tables. Until the replay runs, rollup
reads simply show no pre-deploy history (the pre-deploy state was a random
per-replica fraction, so there is nothing to preserve).

## How to run

The replay is driven through the ops surface (`ops.startReplay`, ops manage
permission required). One run covers both projections:

```jsonc
{
  "projectionNames": ["traceAnalyticsRollup", "evaluationAnalyticsRollup"],
  // ISO timestamp at or before the oldest retention window still served.
  // Epoch is safe: discovery is bounded by what event_log still holds.
  "since": "1970-01-01T00:00:00.000Z",
  "description": "rebuild analytics rollups after Replicated-engine conversion (00065/00066)"
}
```

Replay progress, history and cancellation are available on the same ops
surface (`getReplayStatus`, `getReplayHistory`, `cancelReplay`). The map-path
replay appends increments per event; because the migration left the tables
empty, appending reconstructs exact totals. Do not run the replay twice
concurrently and do not re-run it after a successful pass without truncating
first (the table's contract is replay-rebuilds-truncate-first, see 00038).

## How to verify

Row counts must be identical on every replica once replication catches up
(query each replica directly, not through the load balancer):

```sql
SELECT hostName(), count(), sum(SpanCount)
FROM clusterAllReplicas('langwatch', currentDatabase(), 'trace_analytics_rollup')
GROUP BY hostName();
```

Same shape for `evaluation_analytics_rollup` with `EvalCount`. Every replica
must report the same numbers; divergence means the table is still on a plain
engine somewhere (check `SELECT engine FROM system.tables WHERE name = 'trace_analytics_rollup'`
on each replica, all must say `ReplicatedAggregatingMergeTree`).

Spot-check one busy tenant hour against the slim table, which was never
fragmented (it uses the Replicated engine substitution). The two are close,
not identical by construction: the slim fold caps spans per trace
(MAX_PROCESSED_SPANS) and buckets by a different time column, so expect
tracking numbers, not equality.

```sql
SELECT sum(SpanCount) FROM trace_analytics_rollup
WHERE TenantId = {tenant:String}
  AND BucketStart >= {hour:DateTime64} AND BucketStart < {hourEnd:DateTime64};

SELECT sum(SpanCount) FROM trace_analytics
WHERE TenantId = {tenant:String}
  AND OccurredAt >= {hour:DateTime64} AND OccurredAt < {hourEnd:DateTime64};
```

