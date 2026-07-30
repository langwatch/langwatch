import type { GroupKey } from "@langwatch/event-sourcing";
import { metricShardLabel } from "./shards";

/**
 * Group-key descriptors for this pipeline (ADR-100).
 *
 * Every map projection and the `recordDataPoint` command share one shape:
 * `scope: partition`, keyed on a hashed shard of an identity — the point's
 * own id for storage, the series id for the two projections whose write is a
 * read-modify-write over the series' neighbours (`metricSeriesCatalog`'s
 * dedup and `metricTimeRollup`'s bucket recompute both need every point of
 * one series serialised through the same lane, or two workers can compute
 * conflicting versions of the same row concurrently).
 */

export function metricMapGroupKey(args: {
  tenantId: string;
  projectionName: string;
  identity: string;
  shardCount: number;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: args.projectionName },
    scope: { kind: "partition", parts: ["metric", metricShardLabel(args)] },
  };
}

/**
 * `recordDataPoint`'s lane, sharded rather than the aggregate-scoped default.
 *
 * A fold's command lane wants `scope: aggregate` so nothing races the
 * accumulator it reads back — see ADR-100 decision 4. This aggregate has no
 * fold at all (every mounted projection is a `map`), and its aggregate id is
 * the point's own content hash, so `scope: aggregate` here would mean one
 * lane per point ever received: unbounded cardinality with no correctness
 * benefit, since no two commands ever share an aggregate id to race over.
 * `partition` on a hashed shard of the point id keeps the lane count bounded
 * the same way the three projections' lanes are (ADR-100's worked hashed-shard
 * example), while a command still only ever executes once per point.
 */
export function metricCommandGroupKey(args: {
  tenantId: string;
  /** The point's aggregate id — pass `metricAggregateId(point)`, extracted once. */
  pointId: string;
  shardCount: number;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: "recordDataPoint" },
    scope: {
      kind: "partition",
      parts: [
        "metric-cmd",
        metricShardLabel({
          identity: args.pointId,
          shardCount: args.shardCount,
        }),
      ],
    },
  };
}
