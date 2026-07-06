/**
 * Shared fixture helpers for the large-trace blob-offload integration tests
 * (#4888 / #4215 / ADR-022). These constants and functions are identical across
 * the blob-offload read-path tests, so they live here once instead of being
 * copy-pasted per file (avoids schema/shape drift across the family).
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { expect } from "vitest";
import { IO_PREVIEW_BYTES } from "~/server/app-layer/traces/lean-for-projection";
import type { Event } from "~/server/event-sourcing";

export const AGGREGATE_TYPE = "trace";

/**
 * A 200 KB deterministic payload whose final bytes only exist past the 64 KB
 * preview boundary. The preview is `value.slice(0, 64KB) + "…"`, so it can NEVER
 * contain UNIQUE_TAIL, so a preview-only read fails the tail assertion.
 */
export const UNIQUE_TAIL = "__OFFLOAD_FULL_VALUE_TAIL_MARKER__";
export const LARGE_VALUE = "x".repeat(200_000) + UNIQUE_TAIL;

/** Sanity: the payload genuinely exceeds the offload threshold. */
export function assertOverThreshold(value: string): void {
  expect(Buffer.byteLength(value, "utf-8")).toBeGreaterThan(IO_PREVIEW_BYTES);
}

/**
 * Inserts ONE full event_log row, exactly as the production write path stores it
 * (`EventPayload` IS `event.data`). Mirrors the canonical event_log test idiom
 * (JSONEachRow with a stringified payload) and stamps `_retention_days: 0`
 * (never-expire sentinel, test-only) so a merge-cycle TTL can't evict the fixture
 * mid-run.
 */
export async function insertEventLogRow({
  client,
  tenantId,
  aggregateId,
  eventId,
  eventType,
  eventVersion,
  eventData,
}: {
  client: ClickHouseClient;
  tenantId: string;
  aggregateId: string;
  eventId: string;
  eventType: string;
  eventVersion: string;
  eventData: unknown;
}): Promise<void> {
  const ts = Date.now();
  await client.insert({
    table: "event_log",
    values: [
      {
        TenantId: tenantId,
        AggregateType: AGGREGATE_TYPE,
        AggregateId: aggregateId,
        EventId: eventId,
        EventType: eventType,
        EventVersion: eventVersion,
        EventTimestamp: ts,
        EventOccurredAt: ts,
        EventPayload: JSON.stringify(eventData),
        IdempotencyKey: eventId,
        _retention_days: 0,
      },
    ],
    format: "JSONEachRow",
    // Sync insert so the read-back in the same test sees the row immediately.
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/** Reads span attributes out of a leaned SpanReceived event into a string map. */
export function extractSpanAttrs(event: Event): Record<string, string> {
  const data = event.data as {
    span?: {
      attributes?: Array<{ key: string; value: { stringValue?: string } }>;
    };
  };
  const attrs: Record<string, string> = {};
  for (const attr of data?.span?.attributes ?? []) {
    if (typeof attr.value.stringValue === "string") {
      attrs[attr.key] = attr.value.stringValue;
    }
  }
  return attrs;
}
