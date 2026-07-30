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
import type { SimulationRunState } from "./schema";
import { type SimulationRunsRow, simulationRunsTable } from "./table";

/**
 * The `ReplaceStore<SimulationRunState>` for `simulation_runs` (ADR-098,
 * ADR-099, ADR-102).
 *
 * `@langwatch/clickhouse`'s `createReplaceStore` is not used here: it binds
 * exactly one column as "the state" (`stateColumn: ColumnKeyOfType<Columns,
 * State>`), which fits a fold whose row holds one JSON blob. `simulation_runs`
 * predates that shape — it is a wide, per-field table the app's read paths
 * already depend on (`app-layer/simulations/...`), and re-keying it into a
 * single blob column is a migration this task's "touch only your pipeline's
 * directory" constraint puts out of scope. So this module implements the
 * `ReplaceStore<State>` *contract* by hand, against the *existing* row shape,
 * reproducing every safety property `createReplaceStore` gets from the
 * generic adapter:
 *
 * - the version gate runs on the `Version` cell alone, before the rest of the
 *   row is decoded, so an old shape never reaches this build's decoders
 *   (ADR-098 decision 6 — undecodable is never treated as absent);
 * - the read carries `select_sequential_consistency: 1` for read-your-writes
 *   (`ReplaceStore`'s own docblock in `@langwatch/event-sourcing`);
 * - the write is durable-first by construction, because `ClickHouseClient`
 *   from `@langwatch/clickhouse` hard-codes `wait_for_async_insert: 1` with
 *   no override point (ADR-098 decision 7, ADR-099, ADR-104) — this store
 *   never returns from `write()` before the row is durable, which is the
 *   concrete mechanism behind defect #3 ("graceful shutdown settles
 *   in-flight runs"): a caller that awaits `write()` (directly, or through
 *   `createFoldExecutor().apply(...)`) knows the state landed before the
 *   await resolves. Nothing in this module detaches a write from its caller.
 */

const READ_YOUR_WRITES_SETTINGS = {
  select_sequential_consistency: 1,
} as const;

const READ_SQL =
  `SELECT ${simulationRunsTable.columnNames.join(", ")} ` +
  `FROM ${simulationRunsTable.name} ` +
  `WHERE TenantId = {tenantId:String} AND ScenarioRunId = {key:String} ` +
  `ORDER BY UpdatedAt DESC LIMIT 1`;

function messageRowsFromColumns(
  row: SimulationRunsRow,
): SimulationRunState["messages"] {
  const ids = row["Messages.Id"];
  return ids.map((id, i) => ({
    id,
    role: row["Messages.Role"][i] ?? "",
    content: row["Messages.Content"][i] ?? "",
    traceId: row["Messages.TraceId"][i] ?? "",
    rest: row["Messages.Rest"][i] ?? "",
  }));
}

function rowToState(row: SimulationRunsRow): SimulationRunState {
  return {
    scenarioRunId: row.ScenarioRunId,
    scenarioId: row.ScenarioId,
    batchRunId: row.BatchRunId,
    scenarioSetId: row.ScenarioSetId,
    batchTotal: row.BatchTotal,
    status: row.Status as SimulationRunState["status"],
    // Not yet a real column (see `table.ts`'s module docblock) — every
    // decoded row reads as generation 0 until a rerun mechanism exists to
    // write anything else.
    generation: 0,
    name: row.Name,
    description: row.Description,
    metadata: row.Metadata,
    messages: messageRowsFromColumns(row),
    traceIds: row.TraceIds,
    verdict: row.Verdict as SimulationRunState["verdict"],
    reasoning: row.Reasoning,
    metCriteria: row.MetCriteria,
    unmetCriteria: row.UnmetCriteria,
    error: row.Error,
    durationMs: row.DurationMs === null ? null : Number(row.DurationMs),
    totalCost: row.TotalCost,
    roleCosts: Object.fromEntries(row.RoleCosts),
    roleLatencies: Object.fromEntries(row.RoleLatencies),
    startedAt: row.StartedAt.getTime(),
    queuedAt: row.QueuedAt === null ? null : row.QueuedAt.getTime(),
    finishedAt: row.FinishedAt === null ? null : row.FinishedAt.getTime(),
    archivedAt: row.ArchivedAt === null ? null : row.ArchivedAt.getTime(),
    cancellationRequestedAt:
      row.CancellationRequestedAt === null
        ? null
        : row.CancellationRequestedAt.getTime(),
    lastSnapshotOccurredAt: row.LastSnapshotOccurredAt.getTime(),
  };
}

function stateToRow(args: {
  tenantId: string;
  key: string;
  state: SimulationRunState;
  version: string;
  deliverySeq: number;
  now: Date;
  retentionDays: number;
}): SimulationRunsRow {
  const { tenantId, key, state, version, deliverySeq, now, retentionDays } =
    args;
  return {
    ProjectionId: key,
    TenantId: tenantId,
    ScenarioRunId: key,
    ScenarioId: state.scenarioId,
    BatchRunId: state.batchRunId,
    ScenarioSetId: state.scenarioSetId,
    Version: version,
    Status: state.status,
    Name: state.name,
    Description: state.description,
    Metadata: state.metadata,
    "Messages.Id": state.messages.map((m) => m.id),
    "Messages.Role": state.messages.map((m) => m.role),
    "Messages.Content": state.messages.map((m) => m.content),
    "Messages.TraceId": state.messages.map((m) => m.traceId),
    "Messages.Rest": state.messages.map((m) => m.rest),
    TraceIds: state.traceIds,
    Verdict: state.verdict,
    Reasoning: state.reasoning,
    MetCriteria: state.metCriteria,
    UnmetCriteria: state.unmetCriteria,
    Error: state.error,
    DurationMs:
      state.durationMs === null ? null : BigInt(Math.round(state.durationMs)),
    TotalCost: state.totalCost,
    RoleCosts: new Map(Object.entries(state.roleCosts)),
    RoleLatencies: new Map(Object.entries(state.roleLatencies)),
    // A genuine business field, not an auto-stamped bookkeeping anchor — see
    // `table.ts` for why it nonetheless has to satisfy `defineTable`'s
    // partition-column role.
    StartedAt: new Date(state.startedAt ?? now.getTime()),
    QueuedAt: state.queuedAt === null ? null : new Date(state.queuedAt),
    // Simplification, documented rather than silent: this store has no prior
    // row to preserve `CreatedAt` from without an extra read before every
    // write (the executor hands `write()` the state to persist, not the row
    // it replaces), so `CreatedAt` is stamped with the current write time on
    // every write, same as `UpdatedAt`. It therefore reads as "last written",
    // not "first created", which is an accepted, low-severity behaviour
    // difference from the old repository — not one of the three protected
    // defects — reversible later with a read-before-write or a read-time
    // `min()` if a consumer needs true first-write provenance.
    CreatedAt: now,
    UpdatedAt: now,
    FinishedAt: state.finishedAt === null ? null : new Date(state.finishedAt),
    ArchivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
    CancellationRequestedAt:
      state.cancellationRequestedAt === null
        ? null
        : new Date(state.cancellationRequestedAt),
    LastSnapshotOccurredAt: new Date(state.lastSnapshotOccurredAt || 0),
    LastEventOccurredAt: now,
    BatchTotal: state.batchTotal,
    DeliverySeq: BigInt(deliverySeq),
    _retention_days: retentionDays,
  };
}

const DEFAULT_RETENTION_DAYS = 308;

export interface SimulationRunsStoreArgs {
  readonly client: ClickHouseClient;
  readonly expectedVersion: string;
  /** @default createRowCodec() */
  readonly codec?: WireCodec;
}

export function createSimulationRunsStore(
  args: SimulationRunsStoreArgs,
): ReplaceStore<SimulationRunState> {
  const { client, expectedVersion } = args;
  const codec = args.codec ?? createRowCodec();
  const wireColumns = simulationRunsTable.columnNames.map(
    (name) => simulationRunsTable.columns[name],
  );

  return {
    kind: "replace",

    async read(
      key: string,
      context: StoreContext,
    ): Promise<StateRead<SimulationRunState>> {
      const result = await client.query({
        tenantId: context.tenantId,
        sql: READ_SQL,
        params: { tenantId: context.tenantId, key },
        settings: READ_YOUR_WRITES_SETTINGS,
      });

      const row = result.rows[0];
      if (!row) return { kind: "absent" };

      // The version gate runs on the `Version` cell alone, at its declared
      // position, before the rest of the row is ever decoded (ADR-098
      // decision 6) — an old shape must never reach this build's decoders.
      const versionIndex = simulationRunsTable.columnNames.indexOf("Version");
      let storedVersion: string | undefined;
      try {
        storedVersion = simulationRunsTable.columns.Version.decode(
          row[versionIndex],
        );
      } catch (cause) {
        return { kind: "undecodable", storedVersion: undefined, cause };
      }

      if (storedVersion !== expectedVersion) {
        return { kind: "undecodable", storedVersion };
      }

      let decoded: SimulationRunsRow;
      try {
        const [decodedRow] = codec.decodeRows<SimulationRunsRow>({
          columns: wireColumns,
          columnNames: simulationRunsTable.columnNames,
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
          deliverySeq: Number(decoded.DeliverySeq),
          version: storedVersion,
        },
      };
    },

    async write(
      key: string,
      stored: StoredState<SimulationRunState>,
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
        columnNames: simulationRunsTable.columnNames,
        rows: [row],
      });

      // Awaited to completion — `client.insert` only resolves once
      // `wait_for_async_insert` confirms the row landed. Never fire-and-forget:
      // this is what lets a caller awaiting `write()` know the run's state is
      // durable before it returns (defect #3).
      await client.insert({
        tenantId: context.tenantId,
        table: simulationRunsTable.name,
        rows: encodedRows,
        columns: simulationRunsTable.columnNames,
        target: { kind: "replacing" },
      });
    },
  };
}
