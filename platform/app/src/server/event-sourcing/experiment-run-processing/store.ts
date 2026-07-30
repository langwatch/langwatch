import {
  type ClickHouseClient,
  createRowCodec,
  type WireCodec,
} from "@langwatch/clickhouse";
import type {
  ReplaceStore,
  StateRead,
  StoreContext,
  StoredState,
} from "@langwatch/event-sourcing";
import { parseExperimentRunAggregateId } from "./aggregate";
import type { ExperimentRunState } from "./schema";
import { type ExperimentRunsRow, experimentRunsTable } from "./table";

/**
 * The `ReplaceStore<ExperimentRunState>` for `experiment_runs` (ADR-098,
 * ADR-099, ADR-102).
 *
 * `@langwatch/clickhouse`'s `createReplaceStore` is not used, for the same
 * reason `simulation-processing/store.ts` gives: it binds exactly one column
 * as "the state" (`stateColumn: ColumnKeyOfType<Columns, State>`), which fits
 * a fold whose row holds one JSON blob. `experiment_runs` predates that
 * shape — a wide, per-field table the app's read paths already depend on
 * (`experiments-v3/services/...`) — and re-keying it into a single blob
 * column is a migration outside "touch only your pipeline's directory". So
 * this module implements the `ReplaceStore<State>` contract by hand, against
 * the existing row shape, reproducing every safety property
 * `createReplaceStore` gets from the generic adapter: the version gate runs
 * on the `Version` cell alone before the rest of the row is decoded
 * (ADR-098 decision 6); the read carries `select_sequential_consistency: 1`
 * for read-your-writes; the write is durable-first because
 * `ClickHouseClient` hard-codes `wait_for_async_insert: 1` with no override.
 *
 * === Redelivery: `DeliverySeq` is tracked, but not load-bearing ===
 *
 * `table.ts` declares `DeliverySeq` as the target shape a follow-up migration
 * must add — the column does not exist on the deployed table yet, matching
 * `simulation-processing/store.ts`'s identical precondition. Unlike that
 * fold, though, this one does not *need* the column to be correct today:
 * every field left in `ExperimentRunState` after ADR-103 decision 1 removed
 * the counters is idempotent under redelivery by construction — `total` is
 * `Math.max`, `targets` is a keyed merge, and `startedAt`/`finishedAt`/
 * `stoppedAt` are each written by an event that occurs at most once per run.
 * Re-applying the same batch twice reaches the identical state. This is
 * exactly ADR-098 decision 5's own closing point: "Once an aggregate's
 * totals are derived at read time over the item rows (ADR-103), that fold
 * has no non-idempotent field left, and its dedup requirement disappears
 * with it." So `read()` below reports `deliverySeq: 0` for every found row
 * (there is nowhere to read a real one back from yet), which makes the
 * executor's skip-on-redelivery branch never fire — every delivery is
 * re-applied rather than skipped. That costs a wasted write on a genuine
 * retry, never a wrong answer. Once the migration lands, wiring the real
 * column back in recovers the wasted-write cost; it does not fix a
 * correctness gap, because there was not one.
 */

const READ_YOUR_WRITES_SETTINGS = {
  select_sequential_consistency: 1,
} as const;

const READ_SQL =
  `SELECT ${experimentRunsTable.columnNames.join(", ")} ` +
  `FROM ${experimentRunsTable.name} ` +
  `WHERE TenantId = {tenantId:String} AND RunId = {runId:String} AND ExperimentId = {experimentId:String} ` +
  `ORDER BY UpdatedAt DESC LIMIT 1`;

function rowToState(row: ExperimentRunsRow): ExperimentRunState {
  let targets: ExperimentRunState["targets"];
  try {
    targets = JSON.parse(row.Targets);
  } catch {
    // A row written before this pipeline, or a corrupt cell: fail soft to an
    // empty target list rather than throw out of the version-gated read path
    // — `Targets` is display data, not identity, so this is a degraded read,
    // not a data-loss event.
    targets = [];
  }
  return {
    runId: row.RunId,
    experimentId: row.ExperimentId,
    workflowVersionId: row.WorkflowVersionId,
    total: row.Total,
    targets,
    startedAt: row.StartedAt.getTime(),
    finishedAt: row.FinishedAt === null ? null : row.FinishedAt.getTime(),
    stoppedAt: row.StoppedAt === null ? null : row.StoppedAt.getTime(),
  };
}

function stateToRow(args: {
  tenantId: string;
  key: string;
  state: ExperimentRunState;
  version: string;
  deliverySeq: number;
  now: Date;
  retentionDays: number;
}): ExperimentRunsRow {
  const { tenantId, key, state, version, deliverySeq, now, retentionDays } =
    args;
  return {
    ProjectionId: key,
    TenantId: tenantId,
    RunId: state.runId,
    ExperimentId: state.experimentId,
    WorkflowVersionId: state.workflowVersionId,
    Version: version,
    Total: state.total,
    Targets: JSON.stringify(state.targets),
    StartedAt: new Date(state.startedAt ?? now.getTime()),
    FinishedAt: state.finishedAt === null ? null : new Date(state.finishedAt),
    StoppedAt: state.stoppedAt === null ? null : new Date(state.stoppedAt),
    // Stamped with the current write time on every write, same as
    // `simulation-processing/store.ts`'s identical `CreatedAt` — this store
    // has no prior row to preserve it from without an extra read before
    // every write, which the `ReplaceStore` contract does not otherwise need.
    // Reads as "last written", not "first created"; a low-severity,
    // documented behaviour difference, not one of the defects this rewrite
    // protects.
    CreatedAt: now,
    UpdatedAt: now,
    DeliverySeq: BigInt(deliverySeq),
    _retention_days: retentionDays,
  };
}

const DEFAULT_RETENTION_DAYS = 308;

export interface ExperimentRunsStoreArgs {
  readonly client: ClickHouseClient;
  readonly expectedVersion: string;
  /** @default createRowCodec() */
  readonly codec?: WireCodec;
}

export function createExperimentRunsStore(
  args: ExperimentRunsStoreArgs,
): ReplaceStore<ExperimentRunState> {
  const { client, expectedVersion } = args;
  const codec = args.codec ?? createRowCodec();
  const wireColumns = experimentRunsTable.columnNames.map(
    (name) => experimentRunsTable.columns[name],
  );
  const versionIndex = experimentRunsTable.columnNames.indexOf("Version");

  return {
    kind: "replace",

    async read(
      key: string,
      context: StoreContext,
    ): Promise<StateRead<ExperimentRunState>> {
      const { experimentId, runId } = parseExperimentRunAggregateId(key);

      const result = await client.query({
        tenantId: context.tenantId,
        sql: READ_SQL,
        params: { tenantId: context.tenantId, runId, experimentId },
        settings: READ_YOUR_WRITES_SETTINGS,
      });

      const row = result.rows[0];
      if (!row) return { kind: "absent" };

      // The version gate runs on the `Version` cell alone, at its declared
      // position, before the rest of the row is decoded (ADR-098 decision 6).
      let storedVersion: string | undefined;
      try {
        storedVersion = experimentRunsTable.columns.Version.decode(
          row[versionIndex],
        );
      } catch (cause) {
        return { kind: "undecodable", storedVersion: undefined, cause };
      }

      if (storedVersion !== expectedVersion) {
        return { kind: "undecodable", storedVersion };
      }

      let decoded: ExperimentRunsRow;
      try {
        const [decodedRow] = codec.decodeRows<ExperimentRunsRow>({
          columns: wireColumns,
          columnNames: experimentRunsTable.columnNames,
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
        stored: {
          state: rowToState(decoded),
          // See the module docblock's "Redelivery" section — always 0 until
          // the follow-up migration lands, which is safe because every field
          // this fold writes is idempotent under re-application.
          deliverySeq: 0,
          version: storedVersion,
        },
      };
    },

    async write(
      key: string,
      stored: StoredState<ExperimentRunState>,
      context: StoreContext,
    ): Promise<void> {
      const row = stateToRow({
        tenantId: context.tenantId,
        key,
        state: stored.state,
        version: stored.version,
        deliverySeq: stored.deliverySeq,
        now: new Date(),
        retentionDays: context.retentionDays ?? DEFAULT_RETENTION_DAYS,
      });

      const encodedRows = codec.encodeRows({
        columns: wireColumns,
        columnNames: experimentRunsTable.columnNames,
        rows: [row],
      });

      // Awaited to completion — `client.insert` only resolves once
      // `wait_for_async_insert` confirms the row landed. Never
      // fire-and-forget: this is what lets a caller awaiting `write()` know
      // the run's state is durable before it returns (ADR-098 decision 7).
      await client.insert({
        tenantId: context.tenantId,
        table: experimentRunsTable.name,
        rows: encodedRows,
        columns: experimentRunsTable.columnNames,
        target: { kind: "replacing" },
      });
    },
  };
}
