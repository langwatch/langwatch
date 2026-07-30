import {
  type ClickHouseClient,
  clickhouseAppend,
  clickhouseReplacing,
  deriveRowMapping,
  type FoldStateCache,
  type RowMapping,
} from "@langwatch/clickhouse";
import {
  type AggregateEvent,
  createFoldExecutor,
  createMapExecutor,
  defineMapProjection,
  type Metrics,
} from "@langwatch/event-sourcing";
import { simulationRun } from "./aggregate";
import {
  mapMessageSnapshot,
  mapTextMessageEnd,
  type SimulationMessageRecord,
} from "./messages";
import { type SimulationRunState, simulationRunStateSchema } from "./schema";
import { simulationRunMessagesTable, simulationRunsTable } from "./table";

export { simulationRun } from "./aggregate";

const FOLD_PROJECTION_NAME = "simulationRunState";
const MAP_PROJECTION_NAME = "simulationRunMessages";
const DEFAULT_RETENTION_DAYS = 308;

const derivedRunMapping = deriveRowMapping<
  SimulationRunState,
  typeof simulationRunsTable.columns
>({
  table: simulationRunsTable,
  state: simulationRunStateSchema,
  key: "ScenarioRunId",
  tenant: "TenantId",
  stateVersionColumn: "Version",
  fill: {
    ProjectionId: (state) => state.scenarioRunId,
    CreatedAt: () => new Date(),
    LastEventOccurredAt: () => new Date(),
  },
});

const runRowMapping: RowMapping<
  SimulationRunState,
  typeof simulationRunsTable.columns
> = {
  // `StartedAt` is the deployed partition column, so it cannot hold null: a
  // run not yet seen running partitions by the time its row was written.
  toRow: (state, context) => {
    const row = derivedRunMapping.toRow(state, context);
    return state.startedAt === null
      ? { ...row, StartedAt: context.writtenAt }
      : row;
  },
  fromRow: derivedRunMapping.fromRow,
};

/**
 * One row per message, written per event and never read back into any fold
 * (ADR-098 §2). A snapshot carries several messages, so its handler returns
 * several rows; `textMessageStart` returns none — see `messages.ts`.
 */
export const simulationRunMessages = defineMapProjection({
  name: MAP_PROJECTION_NAME,
  aggregate: simulationRun,
  handle: {
    messageSnapshot: mapMessageSnapshot,
    textMessageEnd: mapTextMessageEnd,
  },
});

export type SimulationRunCommandName = keyof typeof simulationRun.commands;

export interface SimulationProcessingPipelineDeps {
  readonly client: ClickHouseClient;
  readonly cache?: FoldStateCache<SimulationRunState>;
  readonly metrics?: Metrics;
}

export interface ApplySimulationRunCommandArgs<
  Command extends SimulationRunCommandName,
> {
  readonly tenantId: string;
  readonly scenarioRunId: string;
  readonly command: Command;
  /**
   * Parsed against the named command's own `input` schema before `handle`
   * sees it, so a caller's mistake surfaces as a `ZodError` naming the field.
   */
  readonly input: unknown;
  readonly retentionDays?: number;
}

export interface SimulationProcessingPipeline {
  readonly aggregate: typeof simulationRun;
  applySimulationRunCommand<Command extends SimulationRunCommandName>(
    args: ApplySimulationRunCommandArgs<Command>,
  ): Promise<{ events: number }>;
  storeMessages(delivery: {
    readonly tenantId: string;
    readonly events: readonly AggregateEvent[];
    readonly retentionDays?: number;
  }): Promise<{ written: number }>;
}

/**
 * Mounts this pipeline's two projections, each beside the store it writes to.
 *
 * ADR-100 requires the fold's lane to serialise concurrent applies to one run;
 * `simulationRunFoldGroupKey` names that lane but nothing here enforces it, so
 * two concurrent calls for the same `scenarioRunId` can still lose an update
 * to each other until a composition root routes them through the queue.
 */
export function createSimulationProcessingPipeline(
  deps: SimulationProcessingPipelineDeps,
): SimulationProcessingPipeline {
  const runStore = clickhouseReplacing({
    client: deps.client,
    table: simulationRunsTable,
    version: simulationRun.stateVersion,
    key: "ScenarioRunId",
    stateVersionColumn: "Version",
    row: runRowMapping,
    cache: deps.cache,
  });

  const messagesStore = clickhouseAppend<
    SimulationMessageRecord,
    typeof simulationRunMessagesTable.columns
  >({
    client: deps.client,
    table: simulationRunMessagesTable,
    toRow: (record, context) => {
      const now = new Date();
      return {
        ...record,
        TenantId: context.tenantId,
        AcceptedAt: now,
        UpdatedAt: now,
        _retention_days: context.retentionDays ?? DEFAULT_RETENTION_DAYS,
      };
    },
  });

  const fold = createFoldExecutor<SimulationRunState, AggregateEvent>({
    store: runStore,
    init: simulationRun.init,
    apply: simulationRun.apply,
    stateVersion: simulationRun.stateVersion,
    projectionName: FOLD_PROJECTION_NAME,
    metrics: deps.metrics,
  });

  const messages = createMapExecutor<AggregateEvent, SimulationMessageRecord>({
    store: messagesStore,
    map: simulationRunMessages.map,
    projectionName: MAP_PROJECTION_NAME,
    metrics: deps.metrics,
  });

  return {
    aggregate: simulationRun,

    /**
     * Reads current state, lets the named command decide which events to try,
     * folds them and writes the result back — fully awaited end to end, so a
     * caller settling in-flight runs on shutdown knows the terminal state is
     * durable the moment the await returns. The executor re-reads before it
     * writes, so a row this build cannot decode fails there rather than being
     * folded onto genesis here.
     */
    async applySimulationRunCommand(args) {
      const read = await runStore.read(args.scenarioRunId, {
        tenantId: args.tenantId,
        retentionDays: args.retentionDays,
      });

      const state =
        read.kind === "found" ? read.stored.state : simulationRun.init();

      const command = simulationRun.commands[args.command];
      const events = command.handle(
        state,
        command.input.parse(args.input),
        simulationRun.events,
      );

      return fold.apply({
        key: args.scenarioRunId,
        tenantId: args.tenantId,
        events,
        retentionDays: args.retentionDays,
      });
    },

    storeMessages(delivery) {
      return messages.apply(delivery);
    },
  };
}
