import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "../../../../utils/logger/server";
import type { EventRecord, EventRepository } from "./eventRepository.types";

const NUMERIC_STRING_REGEX = /^-?\d+(\.\d+)?$/;

/**
 * Normalizes payload values from ClickHouse.
 *
 * ClickHouse may serialize numeric values as strings (e.g., "123.45" instead of 123.45).
 * This function converts those numeric strings back to numbers.
 *
 * IMPORTANT: This function intentionally does NOT parse JSON strings into objects/arrays.
 * OTLP data contains stringValue fields that hold JSON-encoded content (e.g., message arrays).
 * These must remain as strings to preserve the OTLP schema semantics.
 */
function normalizePayloadValue(value: unknown): unknown {
  if (typeof value === "string") {
    // Only convert numeric strings to numbers
    // Do NOT parse JSON strings - they should remain as strings
    // Simple length check to skip long strings early
    if (value.length > 0 && value.length < 32 && NUMERIC_STRING_REGEX.test(value)) {
      const numberValue = Number(value);
      if (Number.isFinite(numberValue)) {
        return numberValue;
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = normalizePayloadValue(value[i]);
    }
    return value;
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        obj[key] = normalizePayloadValue(obj[key]);
      }
    }
    return obj;
  }

  return value;
}

/**
 * ClickHouse implementation of EventRepository.
 * Handles raw data access to ClickHouse without business logic.
 *
 * Schema in /server/clickhouse/migrations/00002_create_event_log.sql
 */
export class EventRepositoryClickHouse implements EventRepository {
  private readonly logger = createLogger(
    "langwatch:trace-processing:event-repository:clickhouse",
  );

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async getEventRecords(
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
  ): Promise<EventRecord[]> {
    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            EventId,
            EventTimestamp,
            EventOccurredAt,
            EventType,
            EventPayload,
            ProcessingTraceparent
          FROM event_log
          WHERE TenantId = {tenantId:String}
            AND AggregateType = {aggregateType:String}
            AND AggregateId = {aggregateId:String}
          ORDER BY EventTimestamp ASC, EventId ASC
        `,
        query_params: {
          tenantId,
          aggregateType,
          aggregateId: String(aggregateId),
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<{
        EventId: string;
        EventTimestamp: number;
        EventOccurredAt: number;
        EventType: string;
        EventPayload: unknown; // Can be object (when ClickHouse parses JSON) or string (when serialized)
        EventVersion: string;
        ProcessingTraceparent: string;
      }>();

      // Normalize payload so numeric fields stay numeric regardless of how
      // ClickHouse serializes the JSON column.
      return rows.map((row) => ({
        TenantId: tenantId,
        AggregateType: aggregateType,
        AggregateId: String(aggregateId),
        EventId: row.EventId,
        EventTimestamp: row.EventTimestamp,
        EventOccurredAt: row.EventOccurredAt != null && row.EventOccurredAt > 0
          ? row.EventOccurredAt
          : null,
        EventType: row.EventType,
        EventVersion: row.EventVersion,
        EventPayload: normalizePayloadValue(row.EventPayload),
        ProcessingTraceparent: row.ProcessingTraceparent || "",
      }));
    } catch (error) {
      this.logger.error(
        {
          tenantId,
          aggregateType,
          aggregateId: String(aggregateId),
          error,
        },
        "Failed to get event records from ClickHouse",
      );
      throw error;
    }
  }

  async getEventRecordsUpTo(
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
    upToTimestamp: number,
    upToEventId: string,
  ): Promise<EventRecord[]> {
    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            EventId,
            EventTimestamp,
            EventOccurredAt,
            EventType,
            EventPayload,
            EventVersion,
            ProcessingTraceparent
          FROM event_log
          WHERE TenantId = {tenantId:String}
            AND AggregateType = {aggregateType:String}
            AND AggregateId = {aggregateId:String}
            AND (
              EventTimestamp < {upToTimestamp:UInt64}
              OR (
                EventTimestamp = {upToTimestamp:UInt64}
                AND EventId <= {upToEventId:String}
              )
            )
          ORDER BY EventTimestamp ASC, EventId ASC
        `,
        query_params: {
          tenantId,
          aggregateType,
          aggregateId: String(aggregateId),
          upToTimestamp,
          upToEventId,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<{
        EventId: string;
        EventTimestamp: number;
        EventOccurredAt: number;
        EventType: string;
        EventPayload: unknown;
        EventVersion: string;
        ProcessingTraceparent: string;
      }>();

      // Normalize payload so numeric fields stay numeric regardless of how
      // ClickHouse serializes the JSON column.
      return rows.map((row) => ({
        TenantId: tenantId,
        AggregateType: aggregateType,
        AggregateId: String(aggregateId),
        EventId: row.EventId,
        EventTimestamp: row.EventTimestamp,
        EventOccurredAt: row.EventOccurredAt != null && row.EventOccurredAt > 0
          ? row.EventOccurredAt
          : null,
        EventType: row.EventType,
        EventVersion: row.EventVersion,
        EventPayload: normalizePayloadValue(row.EventPayload),
        ProcessingTraceparent: row.ProcessingTraceparent || "",
      }));
    } catch (error) {
      this.logger.error(
        {
          tenantId,
          aggregateType,
          aggregateId: String(aggregateId),
          upToTimestamp,
          upToEventId,
          error,
        },
        "Failed to get event records up to event from ClickHouse",
      );
      throw error;
    }
  }

  async countEventRecords(
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
    beforeTimestamp: number,
    beforeEventId: string,
  ): Promise<number> {
    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT COUNT(DISTINCT EventId) as count
          FROM event_log
          WHERE TenantId = {tenantId:String}
            AND AggregateType = {aggregateType:String}
            AND AggregateId = {aggregateId:String}
            AND (
              EventTimestamp < {beforeTimestamp:UInt64}
              OR (EventTimestamp = {beforeTimestamp:UInt64} AND EventId < {beforeEventId:String})
            )
            AND EventId != {beforeEventId:String}
        `,
        query_params: {
          tenantId,
          aggregateType,
          aggregateId: String(aggregateId),
          beforeTimestamp,
          beforeEventId,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<{ count: string }>();
      const count = Number(rows[0]?.count ?? 0);

      // Log for debugging sequence number issues
      this.logger.debug(
        {
          tenantId,
          aggregateType,
          aggregateId: String(aggregateId),
          beforeTimestamp,
          beforeEventId,
          count,
        },
        "countEventRecords result",
      );

      return count;
    } catch (error) {
      this.logger.error(
        {
          tenantId,
          aggregateType,
          aggregateId: String(aggregateId),
          beforeTimestamp,
          beforeEventId,
          error,
        },
        "Failed to count event records from ClickHouse",
      );
      throw error;
    }
  }

  async insertEventRecords(records: EventRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    try {
      await this.clickHouseClient.insert({
        table: "event_log",
        values: records,
        format: "JSONEachRow",
      });

      this.logger.info(
        {
          recordCount: records.length,
          tenantIds: [...new Set(records.map((r) => r.TenantId))],
          aggregateIds: [...new Set(records.map((r) => String(r.AggregateId)))],
        },
        "Inserted event records to ClickHouse",
      );
    } catch (error) {
      this.logger.debug(
        {
          recordCount: records.length,
          tenantIds: [...new Set(records.map((r) => r.TenantId))],
          aggregateIds: [...new Set(records.map((r) => String(r.AggregateId)))],
          error,
        },
        "Failed to insert event records to ClickHouse",
      );
      throw error;
    }
  }
}
