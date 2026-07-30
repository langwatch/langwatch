import type { ClickHouseClient, TableRow } from "@langwatch/clickhouse";
import {
  type AnyWireColumn,
  createRowCodec,
  type WireCodec,
} from "@langwatch/clickhouse";
import type {
  ReplaceStore,
  StateRead,
  StoreContext,
  StoredState,
} from "@langwatch/event-sourcing";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import { type EvaluationState, evaluationAggregate } from "../aggregate";
import {
  type EvaluationAnalyticsColumns,
  evaluationAnalyticsTable,
} from "./evaluationAnalytics.table";

/**
 * A hand-written `ReplaceStore<EvaluationState>` over `evaluationAnalyticsTable`
 * (ADR-099, ADR-102).
 *
 * === Why not `@langwatch/clickhouse`'s `createReplaceStore`? ===
 *
 * That adapter's contract is `stateColumn: ColumnKeyOfType<Columns, State>` —
 * exactly ONE column whose decoded type equals the whole fold `State`, i.e. a
 * JSON-blob row. `evaluation_analytics` is a hoisted-typed-column BI table
 * (`Score Float64`, `Status LowCardinality(String)`, one column per
 * dimension — see `evaluationAnalytics.table.ts`), the same shape
 * `eval-slim-timeseries-query.ts` reads with plain SQL. No single column on
 * that table holds "the whole state", so `createReplaceStore` cannot adopt it
 * structurally. This module is the same round-trip the OLD
 * `evaluationAnalytics.store.ts` implemented by hand via `defineFoldStore`'s
 * `project`/`decode` pair, rewritten onto `@langwatch/clickhouse`'s exported
 * primitives (`createRowCodec`, `ClickHouseClient`, `defineTable`'s own
 * generated `columnNames`) instead of a bespoke repository.
 *
 * === Why this store is immune to Finding #1 (the moving-partition defect) ===
 *
 * `read()` below is a POINT LOOKUP by `(TenantId, EvaluationId)` — the exact
 * shape `createReplaceStore`'s own generated SQL uses, and deliberately
 * mirrored here: `ORDER BY UpdatedAt DESC LIMIT 1`, no predicate on `OccurredAt`
 * or `CreatedAt` at all. There is no windowed dedup subquery for a moving
 * column to corrupt — that failure mode (`evaluationAnalytics.table.ts`'s
 * Finding #1) belongs entirely to a *scanning, time-bounded* query
 * (`eval-slim-timeseries-query.ts`'s `dedupedSlim()`), which this store does
 * not perform and was never asked to.
 *
 * === The read-outcome contract (ADR-098 decision 6) ===
 *
 * The stored `Version` cell is decoded and compared against
 * `evaluationAggregate.stateVersion` BEFORE the rest of the row is ever
 * touched. A mismatch is `undecodable`, never `absent` — reading it as
 * genesis would fold the next event onto a fresh accumulator and overwrite
 * live state, which is the single most dangerous mistake ADR-098 names.
 */

const READ_YOUR_WRITES_SETTINGS = {
  select_sequential_consistency: 1,
} as const;

/** Epoch-ms UInt64 <-> nullable ms, per migration `00056`'s own convention:
 * `0` on the wire means "not yet" (`StartedAt`/`CompletedAt` both default to
 * `0`, never negative or fractional). */
function decodeEpochMsOrNull(value: bigint): number | null {
  return value === 0n ? null : Number(value);
}
function encodeEpochMsOrNull(value: number | null): bigint {
  return value === null ? 0n : BigInt(value);
}

/**
 * Projects the fold's in-memory state into the table's row shape. Pure: no
 * I/O, no external state — mirrors the OLD `projectEvaluationAnalyticsStateToRow`.
 *
 * `OccurredAt` is the business/display timestamp (never structural — see
 * `evaluationAnalytics.table.ts`'s Finding #1): the latest of `completedAtMs`/
 * `startedAtMs` the state carries, falling back to "now" only for a state
 * that has neither (should not happen in practice, since both handlers set
 * one before this ever runs, but `OccurredAt` has no `DEFAULT` on the
 * deployed column, so a value must always be supplied).
 *
 * `CreatedAt` is stamped fresh on every write, not preserved from a prior
 * row — the same documented simplification `@langwatch/clickhouse`'s
 * `createReplaceStore` makes for its own anchor columns ("stamps it with the
 * write time on every write — it does not preserve the value from a prior
 * write"). This does not weaken Finding #1's fix: what matters for THIS
 * store's own correctness is that `read()` never bounds a query on this
 * column at all (see the module docblock), so whether it drifts by a few
 * minutes between an evaluation's `started` and `reported` writes is
 * immaterial to it. A caller that needs `CreatedAt` to be genuinely frozen
 * at true first-write time — for retention/partition-spread purposes on the
 * physical table — would need `read()` first, which this fold's own
 * read-modify-write cycle already does but does not thread through to
 * `write()` today; noted as a possible refinement, not a correctness gap.
 */
export function projectEvaluationStateToRow(args: {
  /** The fold's key — the row's primary identity. Taken as its own argument
   * rather than read off `state.evaluationId`, matching `createReplaceStore`'s
   * own convention (`row[keyColumn] = key`): the key is authoritative, and
   * `state.evaluationId` is populated by the aggregate's own handlers for
   * domain purposes, not guaranteed identical by the type system. */
  evaluationId: string;
  state: EvaluationState;
  tenantId: string;
  version: string;
  deliverySeq: number;
  retentionDays?: number;
}): TableRow<EvaluationAnalyticsColumns> {
  const { evaluationId, state, tenantId, version, deliverySeq } = args;
  const now = new Date();
  const durationMs =
    state.completedAtMs !== null && state.startedAtMs !== null
      ? Math.max(0, state.completedAtMs - state.startedAtMs)
      : 0;
  const occurredAtMs =
    state.completedAtMs ?? state.startedAtMs ?? now.getTime();

  return {
    TenantId: tenantId,
    EvaluationId: evaluationId,
    Version: version,
    OccurredAt: new Date(occurredAtMs),
    CreatedAt: now,
    UpdatedAt: now,
    EvaluatorType: state.evaluatorType,
    EvaluatorName: state.evaluatorName,
    Status: state.status,
    IsGuardrail: state.isGuardrail,
    Passed: state.passed,
    Score: state.score,
    Label: state.label,
    Model: null,
    TraceId: state.traceId,
    UserId: null,
    ConversationId: null,
    CustomerId: null,
    Origin: null,
    DurationMs: BigInt(durationMs),
    TotalCost: null,
    NonBilledCost: null,
    Attributes: new Map(Object.entries(state.attributes)),
    StartedAt: encodeEpochMsOrNull(state.startedAtMs),
    CompletedAt: encodeEpochMsOrNull(state.completedAtMs),
    _retention_days: args.retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    DeliverySeq: BigInt(deliverySeq),
  };
}

/**
 * Decodes a persisted row back into the fold's working state — the inverse
 * of {@link projectEvaluationStateToRow}, mirroring the OLD
 * `evaluationAnalyticsStateFromRow`.
 *
 * This is a deserialize, not a rebuild: it maps the last committed row's
 * columns back into state and derives nothing from `event_log` (ADR-098
 * decision 3 forbids that on the delivery path). `evaluatorId` has no
 * persisted column on this slim table (feeds no projected column;
 * re-populated by whichever event applies next) and defaults to `""`, the
 * same default the OLD decoder used. `details`/`inputs`/`error`/`errorDetails`
 * have no column on this slim table AT ALL — they default to `null`, which
 * is safe because neither `applyStarted` nor `applyReported` ever reads them
 * back off prior state; both only ever WRITE them from the incoming event's
 * own data (see `aggregate.ts`), so a `reported` event redelivered after a
 * cold read-back still reconstructs the full result correctly.
 */
export function evaluationStateFromRow(
  row: TableRow<EvaluationAnalyticsColumns>,
): EvaluationState {
  return {
    evaluationId: row.EvaluationId,
    evaluatorId: "",
    evaluatorType: row.EvaluatorType,
    evaluatorName: row.EvaluatorName,
    traceId: row.TraceId,
    isGuardrail: row.IsGuardrail,
    status: row.Status as EvaluationState["status"],
    score: row.Score,
    passed: row.Passed,
    label: row.Label,
    details: null,
    inputs: null,
    error: null,
    errorDetails: null,
    costId: null,
    startedAtMs: decodeEpochMsOrNull(row.StartedAt),
    completedAtMs: decodeEpochMsOrNull(row.CompletedAt),
    attributes: Object.fromEntries(row.Attributes),
  };
}

export function createEvaluationAnalyticsStore(
  client: ClickHouseClient,
  deps: { codec?: WireCodec } = {},
): ReplaceStore<EvaluationState> {
  const codec = deps.codec ?? createRowCodec();
  const table = evaluationAnalyticsTable;
  const expectedVersion = evaluationAggregate.stateVersion;

  const wireColumns: AnyWireColumn[] = table.columnNames.map(
    (name) => table.columns[name]!,
  );
  const versionIndex = table.columnNames.indexOf("Version");

  // Generated once, from the table's own declared columns — a point lookup
  // on the full key, never a scanning dedup subquery (see the module
  // docblock's "immune to Finding #1" section).
  const readSql =
    `SELECT ${table.columnNames.join(", ")} ` +
    `FROM ${table.name} ` +
    `WHERE TenantId = {tenantId:String} AND EvaluationId = {key:String} ` +
    `ORDER BY UpdatedAt DESC LIMIT 1`;

  return {
    kind: "replace",

    async read(
      key: string,
      context: StoreContext,
    ): Promise<StateRead<EvaluationState>> {
      const result = await client.query({
        tenantId: context.tenantId,
        sql: readSql,
        params: { tenantId: context.tenantId, key },
        settings: READ_YOUR_WRITES_SETTINGS,
      });

      const row = result.rows[0];
      if (!row) {
        return { kind: "absent" };
      }

      // The version gate runs on the version cell alone, before the rest of
      // the row is decoded — an old shape is not guaranteed to parse safely
      // under the current schema (ADR-098 decision 6).
      let storedVersion: string | undefined;
      let versionCause: unknown;
      try {
        storedVersion = table.columns.Version!.decode(
          row[versionIndex],
        ) as string;
      } catch (cause) {
        versionCause = cause;
      }

      if (storedVersion !== expectedVersion) {
        return versionCause === undefined
          ? { kind: "undecodable", storedVersion }
          : { kind: "undecodable", storedVersion, cause: versionCause };
      }

      let decodedRow: TableRow<EvaluationAnalyticsColumns>;
      try {
        const [decoded] = codec.decodeRows<
          TableRow<EvaluationAnalyticsColumns>
        >({
          columns: wireColumns,
          columnNames: table.columnNames,
          header: result.header,
          rows: [row],
        });
        if (!decoded) {
          return { kind: "undecodable", storedVersion };
        }
        decodedRow = decoded;
      } catch (cause) {
        return { kind: "undecodable", storedVersion, cause };
      }

      return {
        kind: "found",
        stored: {
          state: evaluationStateFromRow(decodedRow),
          deliverySeq: Number(decodedRow.DeliverySeq),
          version: storedVersion,
        },
      };
    },

    async write(
      key: string,
      stored: StoredState<EvaluationState>,
      context: StoreContext,
    ): Promise<void> {
      const row = projectEvaluationStateToRow({
        evaluationId: key,
        state: stored.state,
        tenantId: context.tenantId,
        version: stored.version,
        deliverySeq: stored.deliverySeq,
        retentionDays: context.retentionDays,
      });

      const encodedRows = codec.encodeRows({
        columns: wireColumns,
        columnNames: table.columnNames,
        rows: [row],
      });

      // Durable-first by construction: `client.insert` only resolves once
      // `wait_for_async_insert` confirms the row landed (ADR-099, ADR-104).
      await client.insert({
        tenantId: context.tenantId,
        table: table.name,
        rows: encodedRows,
        columns: table.columnNames,
        target: { kind: "replacing" },
      });
    },
  };
}
