/**
 * Shard-keyed grouping for the spanStorage map projection (ADR-066).
 *
 * The historic key was `span:${event.id}` — the EVENT id — which meant every
 * delivery formed its own single-event group. That bought maximum parallelism
 * at maximum cost: coalescing had nothing to batch (a backed-up tenant paid
 * one full queue job + one ClickHouse insert per span — a linear per-item
 * drain cost whose constant is the whole overhead of a job, the drain floor
 * measured in the 2026-07-30/31 backlog, where spanStorage held ~118 of
 * ~1,030 busy fleet slots), and two deliveries of the SAME span could run in
 * parallel with no ordering guarantee.
 *
 * The shard key gives each tenant `SPAN_STORAGE_MAP_SHARD_COUNT` lanes, with
 * a span's lane pinned by its span id (FNV-1a, the same bucketing the
 * recordSpan command shards use — `commandShardKey.ts`). Same span → same
 * lane, so redeliveries serialize; distinct spans spread across 128 lanes, so
 * effective parallelism matches the fleet's slot budget; and a backed-up lane
 * drains in coalesced bites (`TRACE_SPAN_MAP_COALESCE_MAX_BATCH` events per
 * load/apply/bulkAppend cycle, byte-bounded by the queue's coalesce budget).
 *
 * Rollout note: old `span:{eventId}` groups drain naturally under their
 * historic keys; new events route to lanes. No key collision, no migration.
 * During the transition a span's old-key and new-key deliveries can process
 * in either order — which is exactly the (absence of) guarantee the per-event
 * key always had, and is harmless either way: `stored_spans` is
 * ReplacingMergeTree(StartTime) keyed by (TenantId, TraceId, SpanId)
 * (migration 00002), so the surviving row is chosen by the span's own
 * business timestamp, independent of insert order.
 */

import type { Event } from "../../../domain/types";
import { shardIndexFor } from "../../../pipeline/commandShardKey";

/**
 * Lanes per tenant. Matches `MAX_SPAN_SHARD_COUNT` on the recordSpan command
 * side and the metric maps' shard count: 128 lanes is far more parallelism
 * than any tenant's fair-share of fleet slots, so the change costs no real
 * concurrency, while bounding the number of groups (and parked entries under
 * the tenant soft-cap) a tenant's span traffic can create.
 */
export const SPAN_STORAGE_MAP_SHARD_COUNT = 128;

/**
 * How many same-lane span events one queue dispatch may coalesce into a
 * single bulkAppend. Matches the log/metric map ceilings; the queue's
 * byte budget (ADR-066 pillar 2) bounds fat-span batches independently, so
 * the count ceiling never produces an oversized insert.
 */
export const TRACE_SPAN_MAP_COALESCE_MAX_BATCH = 256;

/**
 * GroupQueue key for a span-received event: `span-map:<lane>`, lane pinned by
 * the span id (from event metadata; the event id is the deterministic
 * fallback for malformed metadata). The framework prepends
 * `<tenantId>/map/spanStorage/` so lanes are always tenant-scoped.
 */
export function spanStorageMapGroupKey(event: Event): string {
  const spanId =
    typeof event.metadata?.spanId === "string" && event.metadata.spanId !== ""
      ? event.metadata.spanId
      : event.id;
  return `span-map:${shardIndexFor(spanId, SPAN_STORAGE_MAP_SHARD_COUNT)}`;
}
