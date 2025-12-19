import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Event } from "../lib/types";

/**
 * Schema for a single row in the ClickHouse event_log JSON export.
 * Matches the output of: SELECT * FROM event_log FORMAT json
 */
const ClickHouseEventRowSchema = z.object({
  TenantId: z.string(),
  IdempotencyKey: z.string().optional(),
  AggregateType: z.string(),
  AggregateId: z.string(),
  EventId: z.string(),
  EventType: z.string(),
  EventTimestamp: z.number(), // Unix ms
  CreatedAt: z.string().optional(),
  EventPayload: z.string(), // JSON string
  ProcessingTraceparent: z.string().optional(),
});

export type ClickHouseEventRow = z.infer<typeof ClickHouseEventRowSchema>;

/**
 * Schema for the full ClickHouse JSON export format.
 * This is the wrapper structure returned by: SELECT * FROM event_log FORMAT json
 */
const ClickHouseJsonSchema = z.object({
  meta: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
    })
  ),
  data: z.array(ClickHouseEventRowSchema),
  rows: z.number(),
  statistics: z
    .object({
      elapsed: z.number(),
      rows_read: z.number(),
      bytes_read: z.number(),
    })
    .optional(),
});

/**
 * Transforms a ClickHouse event_log row to the internal Event format.
 * Adapted from EventStoreClickHouse.recordToEvent.
 *
 * @example
 * const event = clickHouseRowToEvent(row);
 */
export function clickHouseRowToEvent(row: ClickHouseEventRow): Event {
  // Parse JSON string payload
  const data =
    row.EventPayload && row.EventPayload.length > 0
      ? JSON.parse(row.EventPayload)
      : null;

  return {
    id: row.EventId,
    aggregateId: row.AggregateId,
    aggregateType: row.AggregateType,
    tenantId: row.TenantId,
    timestamp: row.EventTimestamp,
    type: row.EventType,
    data,
    metadata: {
      processingTraceparent: row.ProcessingTraceparent || undefined,
    },
  };
}

/**
 * Reads a ClickHouse JSON export file and transforms it to Event[].
 * Expects the format from: SELECT * FROM event_log FORMAT json
 *
 * @example
 * const events = await loadEventLog("./events.json");
 */
export async function loadEventLog(filePath: string): Promise<Event[]> {
  const resolvedPath = path.resolve(filePath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  const clickHouseData = ClickHouseJsonSchema.parse(parsed);

  return clickHouseData.data.map(clickHouseRowToEvent);
}
