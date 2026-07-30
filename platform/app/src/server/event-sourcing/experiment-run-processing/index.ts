import {
  bindIdentifiers,
  type ClickHouseClient,
  clickhouseAppend,
  createRowCodec,
  deriveRowMapping,
} from "@langwatch/clickhouse";
import {
  type AggregateEvent,
  createFoldExecutor,
  createMapExecutor,
  defineMapProjection,
  type Metrics,
  type ReplaceStore,
  type StateRead,
  type StoreContext,
  type StoredState,
} from "@langwatch/event-sourcing";
import { experimentRun, parseExperimentRunAggregateId } from "./aggregate";
import {
  type ExperimentRunItemRecord,
  generateItemProjectionId,
  mapEvaluatorResult,
  mapTargetResult,
} from "./itemsMapping";
import { type ExperimentRunState, experimentRunStateSchema } from "./schema";
import {
  type ExperimentRunsRow,
  experimentRunItemsTable,
  experimentRunsTable,
} from "./table";

export { experimentRun } from "./aggregate";

const FOLD_PROJECTION_NAME = "experimentRunState";
const MAP_PROJECTION_NAME = "experimentRunItems";
const DEFAULT_RETENTION_DAYS = 308;
const READ_YOUR_WRITES_SETTINGS = { select_sequential_consistency: 1 } as const;

const runRowMapping = deriveRowMapping<
  ExperimentRunState,
  typeof experimentRunsTable.columns
>({
  table: experimentRunsTable,
  state: experimentRunStateSchema,
  key: "RunId",
  tenant: "TenantId",
  stateVersionColumn: "Version",
  fill: {
    ProjectionId: (state) => `${state.experimentId}:${state.runId}`,
    CreatedAt: () => new Date(),
  },
});

function decodeTargets(cell: string): ExperimentRunState["targets"] {
  try {
    const parsed: unknown = JSON.parse(cell);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Display data, not identity: a degraded read beats failing the version
    // gate on a row written before this pipeline.
    return [];
  }
}

/**
 * The `experiment_runs` store.
 *
 * `clickhouseReplacing` is not used here, and this is the only reason: it
 * binds ONE key column, while this aggregate's id is the composite
 * `experimentId:runId` and the deployed engine key is
 * `(TenantId, RunId, ExperimentId)`. Reading on `RunId` alone would collapse
 * two experiments that share a run slug, which run slugs routinely do. The
 * mapping, the identifier binding and the codec are all the package's.
 */
function createExperimentRunsStore(args: {
  readonly client: ClickHouseClient;
  readonly version: string;
}): ReplaceStore<ExperimentRunState> {
  const { client, version } = args;
  const codec = createRowCodec();
  const columns = experimentRunsTable.columns;
  const wireColumns = experimentRunsTable.columnNames.map(
    (name) => columns[name],
  );
  const versionIndex = experimentRunsTable.columnNames.indexOf("Version");

  const names = bindIdentifiers();
  const readSql =
    `SELECT ${names.list(experimentRunsTable.columnNames)} ` +
    `FROM ${names.of(experimentRunsTable.name)} ` +
    `WHERE ${names.of("TenantId")} = {tenantId:String} ` +
    `AND ${names.of("RunId")} = {runId:String} ` +
    `AND ${names.of("ExperimentId")} = {experimentId:String} ` +
    `ORDER BY ${names.of("UpdatedAt")} DESC LIMIT 1`;

  return {
    kind: "replace",

    async read(key, context): Promise<StateRead<ExperimentRunState>> {
      const { experimentId, runId } = parseExperimentRunAggregateId(key);
      const result = await client.query({
        tenantId: context.tenantId,
        sql: readSql,
        params: {
          ...names.params,
          tenantId: context.tenantId,
          runId,
          experimentId,
        },
        settings: READ_YOUR_WRITES_SETTINGS,
      });

      const row = result.rows[0];
      if (!row) return { kind: "absent" };

      // The gate runs on the version cell alone, before anything else is
      // decoded: an old shape must never reach this build's decoders.
      let storedVersion: string | undefined;
      try {
        storedVersion = columns.Version.decode(row[versionIndex]);
      } catch (cause) {
        return { kind: "undecodable", storedVersion: undefined, cause };
      }
      if (storedVersion !== version) {
        return { kind: "undecodable", storedVersion };
      }

      try {
        const [decoded] = codec.decodeRows<ExperimentRunsRow>({
          columns: wireColumns,
          columnNames: experimentRunsTable.columnNames,
          header: result.header,
          rows: [row],
        });
        if (!decoded) return { kind: "undecodable", storedVersion };
        return {
          kind: "found",
          stored: {
            state: {
              ...runRowMapping.fromRow(decoded),
              targets: decodeTargets(decoded.Targets),
            },
            version: storedVersion,
          },
        };
      } catch (cause) {
        return { kind: "undecodable", storedVersion, cause };
      }
    },

    async write(
      key: string,
      stored: StoredState<ExperimentRunState>,
      context: StoreContext,
    ): Promise<void> {
      const writtenAt = new Date();
      const row = runRowMapping.toRow(stored.state, {
        tenantId: context.tenantId,
        key,
        version: stored.version,
        writtenAt,
        retentionDays: context.retentionDays ?? DEFAULT_RETENTION_DAYS,
      });
      // Two columns the derived mapping cannot produce: `Targets` is a JSON
      // cell, and `StartedAt` is the partition column, so it cannot hold the
      // null a run that has not started carries in state.
      row.Targets = JSON.stringify(stored.state.targets);
      if (stored.state.startedAt === null) row.StartedAt = writtenAt;

      await client.insert({
        tenantId: context.tenantId,
        table: experimentRunsTable.name,
        rows: codec.encodeRows({
          columns: wireColumns,
          columnNames: experimentRunsTable.columnNames,
          rows: [row],
        }),
        columns: experimentRunsTable.columnNames,
        target: { kind: "replacing" },
      });
    },
  };
}

/** One item row per result event, never read back into any fold (ADR-098 §2). */
export const experimentRunItems = defineMapProjection({
  name: MAP_PROJECTION_NAME,
  aggregate: experimentRun,
  handle: {
    targetResult: mapTargetResult,
    evaluatorResult: mapEvaluatorResult,
  },
});

export type ExperimentRunCommandName = keyof typeof experimentRun.commands;

export interface ExperimentRunPipelineDeps {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
}

export interface ApplyExperimentRunCommandArgs<
  Command extends ExperimentRunCommandName,
> {
  readonly tenantId: string;
  readonly command: Command;
  /** Parsed against the named command's own `input` schema before `handle`. */
  readonly input: unknown;
  readonly retentionDays?: number;
}

export interface ExperimentRunPipeline {
  readonly aggregate: typeof experimentRun;
  applyExperimentRunCommand<Command extends ExperimentRunCommandName>(
    args: ApplyExperimentRunCommandArgs<Command>,
  ): Promise<{ events: number }>;
  storeItems(delivery: {
    readonly tenantId: string;
    readonly events: readonly AggregateEvent[];
    readonly retentionDays?: number;
  }): Promise<{ written: number }>;
}

/** Mounts this pipeline's two projections, each beside the store it writes to. */
export function createExperimentRunPipeline(
  deps: ExperimentRunPipelineDeps,
): ExperimentRunPipeline {
  const runStore = createExperimentRunsStore({
    client: deps.client,
    version: experimentRun.stateVersion,
  });

  const itemsStore = clickhouseAppend<
    ExperimentRunItemRecord,
    typeof experimentRunItemsTable.columns
  >({
    client: deps.client,
    table: experimentRunItemsTable,
    toRow: (record, context) => ({
      ...record,
      TenantId: context.tenantId,
      ProjectionId: generateItemProjectionId({
        tenantId: context.tenantId,
        experimentId: record.ExperimentId,
        runId: record.RunId,
        index: record.RowIndex,
        targetId: record.TargetId,
        resultType: record.ResultType === "evaluator" ? "evaluator" : "target",
        evaluatorId: record.EvaluatorId,
      }),
      CreatedAt: new Date(),
      _retention_days: context.retentionDays ?? DEFAULT_RETENTION_DAYS,
    }),
  });

  const fold = createFoldExecutor<ExperimentRunState, AggregateEvent>({
    store: runStore,
    init: experimentRun.init,
    apply: experimentRun.apply,
    stateVersion: experimentRun.stateVersion,
    projectionName: FOLD_PROJECTION_NAME,
    metrics: deps.metrics,
  });

  const items = createMapExecutor<AggregateEvent, ExperimentRunItemRecord>({
    store: itemsStore,
    map: experimentRunItems.map,
    projectionName: MAP_PROJECTION_NAME,
    metrics: deps.metrics,
  });

  return {
    aggregate: experimentRun,

    /**
     * Reads current state, lets the named command decide which events to try,
     * folds them and writes the result back. The executor re-reads before it
     * writes, so a row this build cannot decode fails there rather than being
     * folded onto genesis here.
     */
    async applyExperimentRunCommand(args) {
      const command = experimentRun.commands[args.command];
      const input = command.input.parse(args.input);
      const key = experimentRun.id(input);

      const read = await runStore.read(key, {
        tenantId: args.tenantId,
        retentionDays: args.retentionDays,
      });
      const state =
        read.kind === "found" ? read.stored.state : experimentRun.init();

      return fold.apply({
        key,
        tenantId: args.tenantId,
        events: command.handle(state, input, experimentRun.events),
        retentionDays: args.retentionDays,
      });
    },

    storeItems(delivery) {
      return items.apply(delivery);
    },
  };
}
