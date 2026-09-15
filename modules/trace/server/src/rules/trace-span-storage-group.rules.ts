// Shard-keyed grouping for spanStorage map projection; each tenant gets
// SPAN_STORAGE_MAP_SHARD_COUNT lanes pinned by span id. @see ADR-066

import type { Event } from "@langwatch/eventing";
import { shardIndexFor } from "./trace-command-shard.rules.ts";

// Lanes per tenant; matches MAX_SPAN_SHARD_COUNT on recordSpan side
export const SPAN_STORAGE_MAP_SHARD_COUNT = 128;

/**
 * How many same-lane span events one queue dispatch may coalesce into a
 * single bulkAppend. Matches the log/metric ceilings; the queue's byte
 * budget (ADR-066 pillar 2) independently bounds fat-span batches.
 */
export const TRACE_SPAN_MAP_COALESCE_MAX_BATCH = 256;

/**
 * GroupQueue key for a span-received event: `span-map:<lane>`, lane pinned
 * by the span id (event id as fallback for malformed metadata). The
 * framework prepends `<tenantId>/map/spanStorage/` for tenant scoping.
 */
export function spanStorageMapGroupKey(event: Event): string {
  const spanId =
    typeof event.metadata?.spanId === "string" && event.metadata.spanId !== ""
      ? event.metadata.spanId
      : event.id;
  return `span-map:${shardIndexFor(spanId, SPAN_STORAGE_MAP_SHARD_COUNT)}`;
}
