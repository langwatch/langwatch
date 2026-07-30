import {
  type AnyWireColumn,
  type ClickHouseClient,
  type ColumnDef,
  ch,
  createRowCodec,
  type WireCodec,
} from "@langwatch/clickhouse";
import type {
  AggregateEvent,
  AppendStore,
  BatchContext,
} from "@langwatch/event-sourcing";

/**
 * `coding_agent_trace_sessions` — the `(TenantId, TraceId) -> SessionId` seam
 * the trace drawer seeks on. This table is the only place a session's
 * contributing traces are recorded; the identity fold does not carry them.
 *
 * Not a `defineTable` declaration: the deployed engine partitions on
 * `OccurredAt`, which is customer-stamped, and `defineTable` requires a
 * `replacing` table's partition column to be frozen and platform-controlled.
 */

export const CODING_AGENT_TRACE_SESSIONS_TABLE_NAME =
  "coding_agent_trace_sessions";

export const codingAgentTraceSessionsColumns = {
  TenantId: ch.string(),
  TraceId: ch.string(),
  SessionId: ch.string(),
  OccurredAt: ch.dateTime64(3),
  UpdatedAt: ch.writtenAt(),
  _retention_days: (() => {
    const schema = ch.float64().schema.refine(
      (value) => Number.isInteger(value) && value >= 0,
      () => ({ message: "not a valid UInt16 wire value" }),
    );
    return {
      chType: "UInt16",
      schema,
      decode: (cell: unknown) => schema.parse(cell),
      encode: (value: number) => value,
      frozen: false,
      platformControlled: false,
      nullable: false,
    } satisfies ColumnDef<number>;
  })(),
} as const;

export type CodingAgentTraceSessionsColumnName =
  keyof typeof codingAgentTraceSessionsColumns;
export const codingAgentTraceSessionsColumnNames = Object.keys(
  codingAgentTraceSessionsColumns,
) as readonly CodingAgentTraceSessionsColumnName[];
const codingAgentTraceSessionsWireColumns: readonly AnyWireColumn[] =
  codingAgentTraceSessionsColumnNames.map(
    (name) => codingAgentTraceSessionsColumns[name],
  );

export type CodingAgentTraceSessionsRow = {
  [K in CodingAgentTraceSessionsColumnName]: (typeof codingAgentTraceSessionsColumns)[K] extends ColumnDef<
    infer T
  >
    ? T
    : never;
};

/** One `(traceId -> sessionId)` contribution — the map projection's output record. */
export interface CodingAgentTraceSessionRecord {
  readonly tenantId: string;
  readonly traceId: string;
  readonly sessionId: string;
  readonly occurredAt: number;
}

const DEFAULT_RETENTION_DAYS = 308;

/**
 * `spanFactsContributed`/`logFactsContributed` -> one trace-session mapping,
 * or `null` when the contribution carries no trace id.
 *
 * Metric contributions never reach this map at all — `schema.ts`'s
 * `metricFactsContributionSchema` has no `traceId` field, because metric
 * datapoints carry no inline trace correlation (see `bridge/dispatch.ts`'s
 * module docblock).
 */
export function mapToTraceSession(
  event: AggregateEvent,
): CodingAgentTraceSessionRecord | null {
  if (event.type === "coding_agent_session/spanFactsContributed") {
    const data = event.data as {
      tenantId: string;
      traceId: string;
      sessionId: string;
      occurredAt: number;
    };
    return {
      tenantId: data.tenantId,
      traceId: data.traceId,
      sessionId: data.sessionId,
      occurredAt: data.occurredAt,
    };
  }
  if (event.type === "coding_agent_session/logFactsContributed") {
    const data = event.data as {
      tenantId: string;
      traceId: string | null;
      sessionId: string;
      occurredAt: number;
    };
    if (data.traceId === null) return null;
    return {
      tenantId: data.tenantId,
      traceId: data.traceId,
      sessionId: data.sessionId,
      occurredAt: data.occurredAt,
    };
  }
  return null;
}

function toRow(
  record: CodingAgentTraceSessionRecord,
  retentionDays: number,
): CodingAgentTraceSessionsRow {
  return {
    TenantId: record.tenantId,
    TraceId: record.traceId,
    SessionId: record.sessionId,
    OccurredAt: new Date(record.occurredAt),
    UpdatedAt: new Date(),
    _retention_days: retentionDays,
  };
}

export interface CodingAgentTraceSessionsStoreArgs {
  readonly client: ClickHouseClient;
  /** @default createRowCodec() */
  readonly codec?: WireCodec;
}

/**
 * The `AppendStore<CodingAgentTraceSessionRecord>` — a blind insert. The
 * deployed engine's own `ReplacingMergeTree(UpdatedAt)` collapses a
 * redelivered/updated `(TenantId, TraceId)` pair at merge, so this store
 * never reads prior state back (`@langwatch/clickhouse`'s `log_records`
 * precedent: `merge: append()` even over a `ReplacingMergeTree` whose sort
 * key already carries per-record identity).
 */
export function createCodingAgentTraceSessionsStore(
  args: CodingAgentTraceSessionsStoreArgs,
): AppendStore<CodingAgentTraceSessionRecord> {
  const { client } = args;
  const codec = args.codec ?? createRowCodec();

  return {
    kind: "append",

    async writeBatch(
      records: readonly CodingAgentTraceSessionRecord[],
      context: BatchContext,
    ): Promise<void> {
      if (records.length === 0) return;

      const retentionDays = context.retentionDays ?? DEFAULT_RETENTION_DAYS;
      const rows = records.map((record) => toRow(record, retentionDays));
      const encodedRows = codec.encodeRows({
        columns: codingAgentTraceSessionsWireColumns,
        columnNames: codingAgentTraceSessionsColumnNames,
        rows,
      });

      await client.insert({
        tenantId: context.tenantId,
        table: CODING_AGENT_TRACE_SESSIONS_TABLE_NAME,
        rows: encodedRows,
        columns: codingAgentTraceSessionsColumnNames,
        target: { kind: "replacing" },
      });
    },
  };
}
