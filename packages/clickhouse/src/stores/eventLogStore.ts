/**
 * The `EventLog` port over the deployed `event_log` table (ADR-108 decision
 * 13, ADR-109). `event_log` is `ReplacingMergeTree` keyed by
 * `[TenantId, AggregateType, AggregateId, IdempotencyKey]`, so a retried
 * append carrying the same idempotency key collapses to one row at merge —
 * the write is retryable, marked here as `{ kind: "replacing" }` so the
 * client's own retry policy treats a transient failure accordingly
 * (ADR-109 decision 4).
 */

import type {
  CommittedEvent,
  EventLog,
  EventLogScan,
} from "@langwatch/event-sourcing";
import type { ClickHouseClient } from "../client/clickhouseClient";
import {
  type AnyWireColumn,
  createRowCodec,
  type WireCodec,
} from "../codec/rowCodec";
import { bindIdentifiers } from "../query/identifiers";
import { type EventLogRow, eventLogTable } from "../tables/eventLog";

export interface ClickHouseEventLogArgs {
  readonly client: ClickHouseClient;
  /** @default createRowCodec() */
  readonly codec?: WireCodec;
}

function toRow(event: CommittedEvent, writtenAt: Date): EventLogRow {
  return {
    TenantId: event.tenantId,
    IdempotencyKey: event.idempotencyKey,
    AggregateType: event.aggregateType,
    AggregateId: event.aggregateId,
    EventId: event.eventId,
    EventType: event.eventType,
    EventVersion: event.eventVersion,
    EventTimestamp: writtenAt,
    CreatedAt: writtenAt,
    // Verbatim — this is the same string the command serialised once, never
    // re-encoded (ADR-108 decision 7).
    EventPayload: event.payload,
    ProcessingTraceparent: event.traceparent ?? "",
    EventOccurredAt: new Date(event.occurredAt),
  };
}

function rowToEvent(row: EventLogRow): CommittedEvent {
  return {
    tenantId: row.TenantId,
    aggregateType: row.AggregateType,
    aggregateId: row.AggregateId,
    eventId: row.EventId,
    eventType: row.EventType,
    eventVersion: row.EventVersion,
    idempotencyKey: row.IdempotencyKey,
    occurredAt: row.EventOccurredAt.getTime(),
    payload: row.EventPayload,
    traceparent:
      row.ProcessingTraceparent === "" ? undefined : row.ProcessingTraceparent,
  };
}

export function clickhouseEventLog(args: ClickHouseEventLogArgs): EventLog {
  const { client } = args;
  const codec = args.codec ?? createRowCodec();
  const wireColumns: readonly AnyWireColumn[] = eventLogTable.wireColumns;

  return {
    async append(events: readonly CommittedEvent[]): Promise<void> {
      const [first] = events;
      if (!first) return;

      const writtenAt = new Date();
      const rows = events.map((event) => toRow(event, writtenAt));
      const encodedRows = codec.encodeRows({
        columns: wireColumns,
        columnNames: eventLogTable.columnNames,
        rows,
      });

      // One insert for the whole batch, never one per event — the batch is a
      // single command's fan-out, so it shares one tenant.
      await client.insert({
        tenantId: first.tenantId,
        table: eventLogTable.name,
        rows: encodedRows,
        columns: eventLogTable.columnNames,
        target: { kind: "replacing" },
      });
    },

    async *scan(query: EventLogScan): AsyncIterable<CommittedEvent> {
      const names = bindIdentifiers();
      const conditions = [
        `${names.of("TenantId")} = {tenantId:String}`,
        `${names.of("AggregateType")} = {aggregateType:String}`,
      ];
      const params: Record<string, unknown> = {
        tenantId: query.tenantId,
        aggregateType: query.aggregateType,
      };

      if (query.aggregateId !== undefined) {
        conditions.push(`${names.of("AggregateId")} = {aggregateId:String}`);
        params.aggregateId = query.aggregateId;
      }
      // Bounding the partition column whenever a range is given is what keeps
      // a replay off cold storage (ADR-109 decision 5) — omitted entirely
      // when neither bound is given, rather than a wide default range.
      if (query.occurredFrom !== undefined) {
        conditions.push(
          `${names.of("EventOccurredAt")} >= {occurredFrom:UInt64}`,
        );
        params.occurredFrom = query.occurredFrom;
      }
      if (query.occurredTo !== undefined) {
        conditions.push(
          `${names.of("EventOccurredAt")} <= {occurredTo:UInt64}`,
        );
        params.occurredTo = query.occurredTo;
      }

      const sql =
        `SELECT ${names.list(eventLogTable.columnNames)} ` +
        `FROM ${names.of(eventLogTable.name)} ` +
        `WHERE ${conditions.join(" AND ")}`;

      // Streamed, not materialised — an aggregate can hold well over 100k
      // events, and this is replay's only bulk reader of the log.
      for await (const batch of client.stream({
        tenantId: query.tenantId,
        sql,
        params: { ...names.params, ...params },
      })) {
        const decoded = codec.decodeRows<EventLogRow>({
          columns: wireColumns,
          columnNames: eventLogTable.columnNames,
          header: undefined,
          rows: batch,
        });
        for (const row of decoded) {
          yield rowToEvent(row);
        }
      }
    },
  };
}
