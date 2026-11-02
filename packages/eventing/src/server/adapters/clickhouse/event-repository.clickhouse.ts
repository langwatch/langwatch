import { createLogger } from "@langwatch/observability";

import { ConfigurationError, EventNotFoundError } from "../../../services/errorHandling.ts";
import type {
  EventOccurredAtWindow,
  EventRecord,
  EventRepository,
} from "../../../stores/repositories/eventRepository.types.ts";
import type {
  EventingClickHouseClient,
  EventingClickHouseClientResolver,
} from "../../clickhouse-client-resolver.ts";
import type { EventingRetentionConfiguration } from "../../eventing-server-runtime.ts";
import { type EventLogIdIndex, eventLogOccurredRange } from "../../tables/event-log-id-index.ts";
import { EventLogAppendFold, type EventLogInsert } from "./event-log-append-fold.ts";

const NUMERIC_STRING_REGEX = /^-?\d+(\.\d+)?$/;

/** Converts numeric strings to numbers, leaving JSON-encoded content as strings. */
function normalizeNumericString(value: string): unknown {
  if (value.length === 0 || value.length >= 32 || !NUMERIC_STRING_REGEX.test(value)) {
    return value;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : value;
}

function normalizePayloadValue(value: unknown): unknown {
  if (typeof value === "string") {
    // Only convert numeric strings to numbers
    // Do NOT parse JSON strings - they should remain as strings
    return normalizeNumericString(value);
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = normalizePayloadValue(value[i]);
    }
    return value;
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      obj[key] = normalizePayloadValue(obj[key]);
    }
    return obj;
  }

  return value;
}

/** All event_log columns the row mapper reads, shared across all three query paths. */
const EVENT_LOG_COLUMNS = [
  "EventId",
  "EventTimestamp",
  "EventOccurredAt",
  "EventType",
  "EventPayload",
  "EventVersion",
  "ProcessingTraceparent",
  "IdempotencyKey",
] as const;

export const EVENT_LOG_SELECT_COLUMNS = EVENT_LOG_COLUMNS.join(",\n            ");

/** Raw `event_log` row shape shared by every read query and the mapper. */
interface EventLogRow {
  EventId: string;
  EventTimestamp: number;
  EventOccurredAt: number;
  EventType: string;
  /** Object when ClickHouse parses the JSON column, string when it does not. */
  EventPayload: unknown;
  EventVersion: string;
  ProcessingTraceparent: string;
  IdempotencyKey: string;
}

/**
 * Rows to records, normalizing the payload so numeric fields stay numeric
 * whichever way ClickHouse serialized the JSON column.
 */
export function mapEventLogRows({
  rows,
  tenantId,
  aggregateType,
  aggregateId,
}: {
  rows: EventLogRow[];
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
}): EventRecord[] {
  return rows.map((row) => ({
    TenantId: tenantId,
    AggregateType: aggregateType,
    AggregateId: String(aggregateId),
    EventId: row.EventId,
    EventTimestamp: row.EventTimestamp,
    EventOccurredAt:
      row.EventOccurredAt != null && row.EventOccurredAt > 0 ? row.EventOccurredAt : null,
    EventType: row.EventType,
    EventVersion: row.EventVersion,
    EventPayload: normalizePayloadValue(row.EventPayload),
    ProcessingTraceparent: row.ProcessingTraceparent || "",
    IdempotencyKey: row.IdempotencyKey || "",
  }));
}

/** The EventOccurredAt bound as SQL; `EventOccurredAt = 0` (unknown) rows are always kept. */
function occurredAtPredicate(window: EventOccurredAtWindow | undefined): {
  predicate: string;
  params: Record<string, number>;
} {
  if (window === undefined) return { predicate: "", params: {} };
  return {
    predicate: `AND (
            EventOccurredAt = 0
            OR (
              EventOccurredAt >= {occurredAtFromMs:UInt64}
              AND EventOccurredAt <= {occurredAtToMs:UInt64}
            )
          )`,
    params: { occurredAtFromMs: window.fromMs, occurredAtToMs: window.toMs },
  };
}

/** Inserts one organisation's appends hold at once before the rest fold into the next. */
const EVENT_LOG_FOLD_MAX_IN_FLIGHT = 4;
/** Rows one shared event log insert carries at most. */
const EVENT_LOG_FOLD_MAX_ROWS = 1_000;

/**
 * ClickHouse implementation of EventRepository: raw data access without
 * business logic. Schema in
 * /server/clickhouse/migrations/00002_create_event_log.sql.
 */
export class EventingClickHouseEventRepository implements EventRepository {
  private readonly logger = createLogger("langwatch:trace-processing:event-repository:clickhouse");

  private readonly appendFold: EventLogAppendFold;

  private readonly resolveClient: EventingClickHouseClientResolver;
  /** Absent on a reads-only repository, which refuses to insert. */
  private readonly retention: EventingRetentionConfiguration | undefined;
  /** The organisation a tenant's rows are written for; absent, every append inserts alone. */
  private readonly organizationOf: ((tenantId: string) => Promise<string | null>) | undefined;
  /** Bounds an aggregate's reads once its pipeline's flag is on; absent, reads stay as today. */
  private readonly eventLogIndex: EventLogIdIndex | undefined;

  private constructor(options: {
    resolveClient: EventingClickHouseClientResolver;
    retention?: EventingRetentionConfiguration;
    organizationOf?: (tenantId: string) => Promise<string | null>;
    eventLogIndex?: EventLogIdIndex;
  }) {
    this.resolveClient = options.resolveClient;
    this.retention = options.retention;
    this.organizationOf = options.organizationOf;
    this.eventLogIndex = options.eventLogIndex;
    this.appendFold = new EventLogAppendFold({
      insert: (insert) => this.insertEventLog(insert),
      maxInFlight: EVENT_LOG_FOLD_MAX_IN_FLIGHT,
      maxRows: EVENT_LOG_FOLD_MAX_ROWS,
    });
  }

  /** Reads only, for a read seat: a process that appends nothing states no retention. */
  static createForEventReads(options: {
    resolveClient: EventingClickHouseClientResolver;
    eventLogIndex?: EventLogIdIndex;
  }): Pick<EventRepository, "getEventRecord" | "getEventRecords" | "findEventRecordsOfAggregates"> {
    return new EventingClickHouseEventRepository({
      resolveClient: options.resolveClient,
      ...(options.eventLogIndex === undefined ? {} : { eventLogIndex: options.eventLogIndex }),
    });
  }

  static create(options: {
    resolveClient: EventingClickHouseClientResolver;
    retention: EventingRetentionConfiguration;
    /** The directory the routed member places tenants with; folds appends per organisation. */
    organizationOf?: (tenantId: string) => Promise<string | null>;
    eventLogIndex?: EventLogIdIndex;
  }): EventingClickHouseEventRepository {
    return new EventingClickHouseEventRepository(options);
  }

  /**
   * The lower bound an aggregate's read takes: the caller's own, else the index's earliest
   * occurred time. A miss keeps today's unbounded read: a fold reads its whole history, and rows
   * with no occurred time are not in the index (the `EventOccurredAt = 0` arm keeps them).
   */
  private async occurredAtFloor({
    tenantId,
    aggregateType,
    aggregateId,
    occurredAtFromMs,
  }: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    occurredAtFromMs: number | undefined;
  }): Promise<number | undefined> {
    // The caller's own lower bound already prunes: no index round trip on the fold's hot path.
    if (occurredAtFromMs !== undefined && occurredAtFromMs > 0) return occurredAtFromMs;
    const range = await eventLogOccurredRange({
      index: this.eventLogIndex,
      read: "aggregate",
      tenantId,
      aggregateTypes: [aggregateType],
      aggregateIds: [String(aggregateId)],
    });
    if (range === null) return occurredAtFromMs;
    return Math.max(range.fromMs, occurredAtFromMs ?? 0);
  }

  /**
   * The earliest occurred time across the asked aggregates, read per tenant because the index
   * is tenant-scoped. Any tenant the index misses keeps today's unbounded read for the lot.
   */
  private async occurredAtFloorOfAggregates({
    aggregates,
    aggregateType,
  }: {
    aggregates: readonly { tenantId: string; aggregateId: string }[];
    aggregateType: string;
  }): Promise<number | undefined> {
    const idsByTenant = new Map<string, Set<string>>();
    for (const { tenantId, aggregateId } of aggregates) {
      const ids = idsByTenant.get(tenantId) ?? new Set<string>();
      ids.add(String(aggregateId));
      idsByTenant.set(tenantId, ids);
    }
    const ranges = await Promise.all(
      [...idsByTenant].map(([tenantId, ids]) =>
        eventLogOccurredRange({
          index: this.eventLogIndex,
          read: "aggregate",
          tenantId,
          aggregateTypes: [aggregateType],
          aggregateIds: [...ids],
        }),
      ),
    );
    if (ranges.length === 0 || ranges.some((range) => range === null)) return undefined;
    return Math.min(...ranges.flatMap((range) => (range === null ? [] : [range.fromMs])));
  }

  private async getClient(tenantId: string): Promise<EventingClickHouseClient> {
    return this.resolveClient(tenantId);
  }

  async getEventRecord(request: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    eventId: string;
    occurredAt?: EventOccurredAtWindow;
  }): Promise<EventRecord> {
    const { tenantId, aggregateType, aggregateId, eventId } = request;
    // The aggregate's indexed span first (Alex, Q6, 2026-10-11); else the caller's window.
    const indexed = await eventLogOccurredRange({
      index: this.eventLogIndex,
      read: "event",
      tenantId,
      aggregateTypes: [aggregateType],
      aggregateIds: [String(aggregateId)],
    });
    const window = occurredAtPredicate(indexed ?? request.occurredAt);
    const client = await this.getClient(tenantId);
    const result = await client.query({
      query: `
        SELECT
          ${EVENT_LOG_SELECT_COLUMNS}
        FROM event_log
        WHERE TenantId = {tenantId:String}
          AND AggregateType = {aggregateType:String}
          AND AggregateId = {aggregateId:String}
          AND EventId = {eventId:String}
          ${window.predicate}
        ORDER BY EventTimestamp DESC
        LIMIT 1
      `,
      query_params: {
        tenantId,
        aggregateType,
        aggregateId,
        eventId,
        ...window.params,
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<EventLogRow>();
    const records = mapEventLogRows({
      rows,
      tenantId,
      aggregateType,
      aggregateId,
    });

    const record = records[0];
    if (!record) {
      // The indexed span holds every event of the aggregate, so the caller's fallback is moot.
      throw new EventNotFoundError({
        eventId,
        aggregateId,
        aggregateType,
        wholeStream: indexed !== null,
      });
    }

    return record;
  }

  async getEventRecords({
    tenantId,
    aggregateType,
    aggregateId,
    occurredAtFromMs: requestedFromMs,
  }: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    occurredAtFromMs?: number;
  }): Promise<EventRecord[]> {
    try {
      const occurredAtFromMs = await this.occurredAtFloor({
        tenantId,
        aggregateType,
        aggregateId,
        occurredAtFromMs: requestedFromMs,
      });
      const client = await this.getClient(tenantId);
      // When a lower bound is supplied, add a predicate on EventOccurredAt so
      // ClickHouse can prune weekly partitions older than the bound instead of
      // cold-scanning S3. Rows with unknown occurred time (0) are always kept
      // so the bound can never drop an event; the partition key is monotonic
      // in EventOccurredAt so the predicate actually prunes.
      const hasLowerBound = typeof occurredAtFromMs === "number" && occurredAtFromMs > 0;
      const occurredAtFilter = hasLowerBound
        ? "AND (EventOccurredAt = 0 OR EventOccurredAt >= {occurredAtFromMs:UInt64})"
        : "";
      const result = await client.query({
        query: `
          SELECT
            ${EVENT_LOG_SELECT_COLUMNS}
          FROM event_log
          WHERE TenantId = {tenantId:String}
            AND AggregateType = {aggregateType:String}
            AND AggregateId = {aggregateId:String}
            ${occurredAtFilter}
          ORDER BY EventTimestamp ASC, EventId ASC
        `,
        query_params: {
          tenantId,
          aggregateType,
          aggregateId: String(aggregateId),
          ...(hasLowerBound ? { occurredAtFromMs } : {}),
        },
        format: "JSONEachRow",
        // Unbounded, this is one aggregate's whole history by its key: a fold needs all of it.
        ...(hasLowerBound ? {} : { SKIP_COLD_SCAN_CHECK: true as const }),
      });

      const rows = await result.json<EventLogRow>();

      return mapEventLogRows({ rows, tenantId, aggregateType, aggregateId });
    } catch (error) {
      this.logger.warn(
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

  async findEventRecordsOfAggregates({
    aggregates,
    aggregateType,
  }: {
    aggregates: readonly { tenantId: string; aggregateId: string }[];
    aggregateType: string;
  }): Promise<EventRecord[]> {
    const tenantIds = [...new Set(aggregates.map(({ tenantId }) => tenantId))];
    const aggregateIds = [...new Set(aggregates.map(({ aggregateId }) => String(aggregateId)))];
    const [resolvingTenantId] = tenantIds;
    if (resolvingTenantId === void 0) return [];
    try {
      const occurredAtFromMs = await this.occurredAtFloorOfAggregates({
        aggregates,
        aggregateType,
      });
      const hasLowerBound = typeof occurredAtFromMs === "number" && occurredAtFromMs > 0;
      const occurredAtFilter = hasLowerBound
        ? "AND (EventOccurredAt = 0 OR EventOccurredAt >= {occurredAtFromMs:UInt64})"
        : "";
      const client = await this.getClient(resolvingTenantId);
      const result = await client.query({
        query: `
          SELECT
            TenantId,
            AggregateId,
            ${EVENT_LOG_SELECT_COLUMNS}
          FROM event_log
          WHERE TenantId IN ({tenantIds:Array(String)})
            AND AggregateType = {aggregateType:String}
            AND AggregateId IN ({aggregateIds:Array(String)})
            ${occurredAtFilter}
          ORDER BY TenantId ASC, AggregateId ASC, EventTimestamp ASC, EventId ASC
        `,
        query_params: {
          tenantIds,
          aggregateType,
          aggregateIds,
          ...(hasLowerBound ? { occurredAtFromMs } : {}),
        },
        format: "JSONEachRow",
        tenantIds,
        // Unbounded, each aggregate's whole history by its key, as in `getEventRecords`.
        ...(hasLowerBound ? {} : { SKIP_COLD_SCAN_CHECK: true as const }),
      });
      const rows = await result.json<EventLogRow & { TenantId: string; AggregateId: string }>();
      const asked = new Set(
        aggregates.map(({ tenantId, aggregateId }) => `${tenantId}\n${aggregateId}`),
      );
      return rows
        .filter((row) => asked.has(`${row.TenantId}\n${row.AggregateId}`))
        .flatMap((row) =>
          mapEventLogRows({
            rows: [row],
            tenantId: row.TenantId,
            aggregateType,
            aggregateId: row.AggregateId,
          }),
        );
    } catch (error) {
      this.logger.warn(
        {
          tenantCount: tenantIds.length,
          aggregateType,
          aggregateCount: aggregateIds.length,
          error,
        },
        "Failed to get event records of many aggregates from ClickHouse",
      );
      throw error;
    }
  }

  async getEventRecordsUpTo(request: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    upToTimestamp: number;
    upToEventId: string;
    occurredAtFromMs?: number;
  }): Promise<EventRecord[]> {
    const { tenantId, aggregateType, aggregateId, upToTimestamp, upToEventId } = request;
    try {
      const occurredAtFromMs = await this.occurredAtFloor({
        tenantId,
        aggregateType,
        aggregateId,
        occurredAtFromMs: request.occurredAtFromMs,
      });
      const client = await this.getClient(tenantId);
      // Same partition-pruning bound as `getEventRecords`, and for the same
      // reason: the upper bound is on EventTimestamp (acceptance order), but the
      // table is PARTITION BY toYearWeek(EventOccurredAt), so ONLY an
      // EventOccurredAt predicate prunes. Without one this walks every weekly
      // partition ever written, including the cold tier on S3.
      const hasLowerBound = typeof occurredAtFromMs === "number" && occurredAtFromMs > 0;
      const occurredAtFilter = hasLowerBound
        ? "AND (EventOccurredAt = 0 OR EventOccurredAt >= {occurredAtFromMs:UInt64})"
        : "";
      const result = await client.query({
        query: `
          SELECT
            ${EVENT_LOG_SELECT_COLUMNS}
          FROM event_log
          WHERE TenantId = {tenantId:String}
            AND AggregateType = {aggregateType:String}
            AND AggregateId = {aggregateId:String}
            ${occurredAtFilter}
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
          ...(hasLowerBound ? { occurredAtFromMs } : {}),
        },
        format: "JSONEachRow",
        // Unbounded, as in `getEventRecords`: a long-lived aggregate's history by its key.
        ...(hasLowerBound ? {} : { SKIP_COLD_SCAN_CHECK: true as const }),
      });

      const rows = await result.json<EventLogRow>();

      return mapEventLogRows({ rows, tenantId, aggregateType, aggregateId });
    } catch (error) {
      this.logger.warn(
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

  /**
   * Cursor-paginated `getEventRecordsUpTo`. Same upper bound and order, plus a
   * strict `after` cursor and `LIMIT`, so a re-fold of a huge aggregate streams
   * history a page at a time instead of OOMing on every EventPayload blob at once.
   */
  async getEventRecordsUpToPaged(request: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    upToTimestamp: number;
    upToEventId: string;
    after: { timestamp: number; eventId: string } | undefined;
    limit: number;
    occurredAtFromMs?: number;
  }): Promise<EventRecord[]> {
    const { tenantId, aggregateType, aggregateId } = request;
    try {
      const occurredAtFromMs = await this.occurredAtFloor({
        tenantId,
        aggregateType,
        aggregateId,
        occurredAtFromMs: request.occurredAtFromMs,
      });
      const client = await this.getClient(tenantId);
      const { query, query_params, declaresFullScan } = this.buildPagedQuery({
        ...request,
        occurredAtFromMs,
      });
      const result = await client.query({
        query,
        query_params,
        format: "JSONEachRow",
        // Unbounded, as in `getEventRecords`: a long-lived aggregate's history by its key.
        ...(declaresFullScan ? { SKIP_COLD_SCAN_CHECK: true as const } : {}),
      });
      const rows = await result.json<EventLogRow>();
      return mapEventLogRows({ rows, tenantId, aggregateType, aggregateId });
    } catch (error) {
      this.logger.warn(
        { ...request, aggregateId: String(aggregateId), error },
        "Failed to get paged event records up to event from ClickHouse",
      );
      throw error;
    }
  }

  /** Query + params for {@link getEventRecordsUpToPaged}. */
  private buildPagedQuery(request: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    upToTimestamp: number;
    upToEventId: string;
    after: { timestamp: number; eventId: string } | undefined;
    limit: number;
    occurredAtFromMs?: number;
  }): {
    query: string;
    query_params: Record<string, unknown>;
    declaresFullScan: boolean;
  } {
    const {
      tenantId,
      aggregateType,
      aggregateId,
      upToTimestamp,
      upToEventId,
      after,
      limit,
      occurredAtFromMs,
    } = request;
    const afterClause = after
      ? `AND (
            EventTimestamp > {afterTimestamp:UInt64}
            OR (
              EventTimestamp = {afterTimestamp:UInt64}
              AND EventId > {afterEventId:String}
            )
          )`
      : "";
    // The cursor and the upper bound are both on EventTimestamp, which is NOT
    // the partition key — so neither prunes. Only EventOccurredAt does.
    const hasLowerBound = typeof occurredAtFromMs === "number" && occurredAtFromMs > 0;
    const occurredAtFilter = hasLowerBound
      ? "AND (EventOccurredAt = 0 OR EventOccurredAt >= {occurredAtFromMs:UInt64})"
      : "";
    return {
      query: `
        SELECT
          ${EVENT_LOG_SELECT_COLUMNS}
        FROM event_log
        WHERE TenantId = {tenantId:String}
          AND AggregateType = {aggregateType:String}
          AND AggregateId = {aggregateId:String}
          ${occurredAtFilter}
          AND (
            EventTimestamp < {upToTimestamp:UInt64}
            OR (
              EventTimestamp = {upToTimestamp:UInt64}
              AND EventId <= {upToEventId:String}
            )
          )
          ${afterClause}
        ORDER BY EventTimestamp ASC, EventId ASC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId,
        aggregateType,
        aggregateId: String(aggregateId),
        upToTimestamp,
        upToEventId,
        ...(hasLowerBound ? { occurredAtFromMs } : {}),
        ...(after ? { afterTimestamp: after.timestamp, afterEventId: after.eventId } : {}),
        limit,
      },
      declaresFullScan: !hasLowerBound,
    };
  }

  async countEventRecords({
    tenantId,
    aggregateType,
    aggregateId,
    beforeTimestamp,
    beforeEventId,
  }: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    beforeTimestamp: number;
    beforeEventId: string;
  }): Promise<number> {
    try {
      const occurredAtFromMs = await this.occurredAtFloor({
        tenantId,
        aggregateType,
        aggregateId,
        occurredAtFromMs: undefined,
      });
      const hasLowerBound = occurredAtFromMs !== undefined;
      const client = await this.getClient(tenantId);
      const result = await client.query({
        query: `
          SELECT COUNT(DISTINCT EventId) as count
          FROM event_log
          WHERE TenantId = {tenantId:String}
            AND AggregateType = {aggregateType:String}
            AND AggregateId = {aggregateId:String}
            ${hasLowerBound ? "AND (EventOccurredAt = 0 OR EventOccurredAt >= {occurredAtFromMs:UInt64})" : ""}
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
          ...(hasLowerBound ? { occurredAtFromMs } : {}),
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<{ count: string }>();
      const count = Number(rows[0]?.count ?? 0);

      return count;
    } catch (error) {
      this.logger.warn(
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

    const retention = this.retention;
    if (retention === undefined) {
      throw new ConfigurationError(
        "EventingClickHouseEventRepository",
        "This repository was built for event reads and states no retention, so it cannot insert.",
        { operation: "insertEventRecords" },
      );
    }

    try {
      const tenantId = records[0]!.TenantId;
      const stampedRecords = records.map((r) => ({
        ...r,
        // Default-on: stamp the process-injected fallback when the store did
        // not resolve a tenant policy, never leave it to the column default.
        _retention_days: r._retention_days ?? retention.defaultRetentionDays,
      }));
      const organizationId = await this.organizationOf?.(tenantId);
      if (organizationId === undefined || organizationId === null) {
        await this.insertEventLog({ tenantId, rows: stampedRecords });
      } else {
        await this.appendFold.append({
          organizationId,
          tenantId,
          rows: stampedRecords,
        });
      }
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

  /**
   * One insert, flushed before it answers; a folded one declares its tenant set. Async
   * deduplication is off, as the server's default before 26.2 has it: the log collapses repeats
   * by IdempotencyKey itself, and an insert with it off may share a statement (ADR-187).
   */
  private async insertEventLog({ tenantId, rows, tenantIds }: EventLogInsert): Promise<void> {
    const client = await this.getClient(tenantId);
    await client.insert({
      table: "event_log",
      values: rows,
      format: "JSONEachRow",
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
        async_insert_deduplicate: 0,
      },
      ...(tenantIds === undefined ? {} : { tenantIds }),
    });
  }
}
