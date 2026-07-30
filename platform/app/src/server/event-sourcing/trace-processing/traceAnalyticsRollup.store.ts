import type { ReplaceStore, StateRead, StoreContext, StoredState } from "@langwatch/event-sourcing";
import { createRowCodec, type ClickHouseClient, type WireCodec } from "@langwatch/clickhouse";
import { traceAnalyticsRollupTable, type TraceAnalyticsRollupRow } from "./traceAnalyticsRollup.table";
import { initRollupState, type RollupState } from "./traceAnalyticsRollup";

/**
 * The `ReplaceStore<RollupState>` for `trace_analytics_rollup`. Hand-rolled
 * for the same reason as the two trace folds — a wide, per-column table a
 * dashboard queries directly — though `RollupState` itself is flat (no
 * `Map`/`Set` accumulators), so the round-trip here is exact, unlike
 * `traceSummary.store.ts`/`traceAnalytics.store.ts`'s documented
 * approximation.
 */

const READ_YOUR_WRITES_SETTINGS = { select_sequential_consistency: 1 } as const;

const READ_SQL =
  `SELECT ${traceAnalyticsRollupTable.columnNames.join(", ")} ` +
  `FROM ${traceAnalyticsRollupTable.name} ` +
  `WHERE TenantId = {tenantId:String} AND concat(toString(BucketStart), ':', Model, ':', SpanType) = {key:String} ` +
  `ORDER BY UpdatedAt DESC LIMIT 1`;

function rowToState(row: TraceAnalyticsRollupRow): RollupState {
  return {
    bucketStartMs: row.BucketStart.getTime(),
    model: row.Model,
    spanType: row.SpanType,
    spanCount: Number(row.SpanCount),
    traceCount: Number(row.TraceCount),
    errorCount: Number(row.ErrorCount),
    costSum: row.CostSum,
    nonBilledCostSum: row.NonBilledCostSum,
    durationSum: Number(row.DurationSum),
    promptTokensSum: Number(row.PromptTokensSum),
    completionTokensSum: Number(row.CompletionTokensSum),
    cacheReadTokensSum: Number(row.CacheReadTokensSum),
    cacheWriteTokensSum: Number(row.CacheWriteTokensSum),
    reasoningTokensSum: Number(row.ReasoningTokensSum),
  };
}

function stateToRow(args: {
  tenantId: string;
  state: RollupState;
  version: string;
  now: Date;
  retentionDays: number;
}): TraceAnalyticsRollupRow {
  const { state } = args;
  return {
    TenantId: args.tenantId,
    BucketStart: new Date(state.bucketStartMs),
    Model: state.model,
    SpanType: state.spanType,
    Version: args.version,
    SpanCount: BigInt(state.spanCount),
    TraceCount: BigInt(state.traceCount),
    ErrorCount: BigInt(state.errorCount),
    CostSum: state.costSum,
    NonBilledCostSum: state.nonBilledCostSum,
    DurationSum: BigInt(Math.max(0, Math.round(state.durationSum))),
    PromptTokensSum: BigInt(state.promptTokensSum),
    CompletionTokensSum: BigInt(state.completionTokensSum),
    CacheReadTokensSum: BigInt(state.cacheReadTokensSum),
    CacheWriteTokensSum: BigInt(state.cacheWriteTokensSum),
    ReasoningTokensSum: BigInt(state.reasoningTokensSum),
    AcceptedAt: new Date(state.bucketStartMs || args.now.getTime()),
    UpdatedAt: args.now,
    _retention_days: args.retentionDays,
  };
}

const DEFAULT_RETENTION_DAYS = 90;

export interface TraceAnalyticsRollupStoreArgs {
  readonly client: ClickHouseClient;
  readonly expectedVersion: string;
  /** @default createRowCodec() */
  readonly codec?: WireCodec;
}

export function createTraceAnalyticsRollupStore(args: TraceAnalyticsRollupStoreArgs): ReplaceStore<RollupState> {
  const { client, expectedVersion } = args;
  const codec = args.codec ?? createRowCodec();
  const wireColumns = traceAnalyticsRollupTable.columnNames.map((name) => traceAnalyticsRollupTable.columns[name]);
  const versionIndex = traceAnalyticsRollupTable.columnNames.indexOf("Version");

  return {
    kind: "replace",

    async read(key: string, context: StoreContext): Promise<StateRead<RollupState>> {
      const result = await client.query({
        tenantId: context.tenantId,
        sql: READ_SQL,
        params: { tenantId: context.tenantId, key },
        settings: READ_YOUR_WRITES_SETTINGS,
      });

      const row = result.rows[0];
      if (!row) return { kind: "absent" };

      let storedVersion: string | undefined;
      try {
        storedVersion = traceAnalyticsRollupTable.columns.Version.decode(row[versionIndex]);
      } catch (cause) {
        return { kind: "undecodable", storedVersion: undefined, cause };
      }
      if (storedVersion !== expectedVersion) return { kind: "undecodable", storedVersion };

      let decoded: TraceAnalyticsRollupRow;
      try {
        const [decodedRow] = codec.decodeRows<TraceAnalyticsRollupRow>({
          columns: wireColumns,
          columnNames: traceAnalyticsRollupTable.columnNames,
          header: result.header,
          rows: [row],
        });
        if (!decodedRow) return { kind: "undecodable", storedVersion };
        decoded = decodedRow;
      } catch (cause) {
        return { kind: "undecodable", storedVersion, cause };
      }

      return {
        kind: "found",
        stored: { state: rowToState(decoded), version: storedVersion },
      };
    },

    async write(key: string, stored: StoredState<RollupState>, context: StoreContext): Promise<void> {
      void key; // the bucket key is fully reconstructable from state's own bucketStartMs/model/spanType
      const row = stateToRow({
        tenantId: context.tenantId,
        state: stored.state,
        version: stored.version,
        now: new Date(),
        retentionDays: context.retentionDays ?? DEFAULT_RETENTION_DAYS,
      });

      const encodedRows = codec.encodeRows({
        columns: wireColumns,
        columnNames: traceAnalyticsRollupTable.columnNames,
        rows: [row],
      });

      await client.insert({
        tenantId: context.tenantId,
        table: traceAnalyticsRollupTable.name,
        rows: encodedRows,
        columns: traceAnalyticsRollupTable.columnNames,
        target: { kind: "replacing" },
      });
    },
  };
}

export { initRollupState };
