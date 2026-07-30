import {
  type ClickHouseClient,
  clickhouseAppend,
  clickhouseReplacing,
  deriveRowMapping,
  type FoldStateCache,
  noFoldStateCache,
} from "@langwatch/clickhouse";
import {
  ConfigurationError,
  definePipeline,
  type GroupKey,
  type Metrics,
  type Mount,
  validateMount,
} from "@langwatch/event-sourcing";
import { completeExperimentRun } from "./completeExperimentRun.command";
import {
  EXPERIMENT_RUN_PIPELINE_NAME,
  EXPERIMENT_RUN_PIPELINE_PREFIX,
  experimentRunEvents,
} from "./events";
import {
  deliverExperimentRunExecutionFailRun,
  EXPERIMENT_RUN_STALLED_CODE,
  type ExperimentRunExecutionDeps,
  experimentRunExecutionFailRunIntentSchema,
  experimentRunExecutionStateSchema,
  handleExperimentRunCompleted,
  handleExperimentRunEvaluatorResult,
  handleExperimentRunStarted,
  handleExperimentRunTargetResult,
  initExperimentRunExecutionState,
  onExperimentRunExecutionWake,
} from "./experimentRunExecution.process";
import {
  type ExperimentRunItemRecord,
  generateItemProjectionId,
  mapEvaluatorResult,
  mapTargetResult,
} from "./experimentRunItems.projection";
import {
  applyRunCompleted,
  applyRunStarted,
  EXPERIMENT_RUN_STATE_VERSION_PIN,
} from "./experimentRunState.projection";
import { recordEvaluatorResult } from "./recordEvaluatorResult.command";
import { recordTargetResult } from "./recordTargetResult.command";
import {
  type ExperimentRunState,
  experimentRunAggregateId,
  experimentRunStateSchema,
  initExperimentRunState,
  parseExperimentRunAggregateId,
} from "./schema";
import { startExperimentRun } from "./startExperimentRun.command";
import {
  type ExperimentRunsRow,
  experimentRunItemsTable,
  experimentRunsTable,
} from "./table";

export {
  EXPERIMENT_RUN_PIPELINE_NAME,
  EXPERIMENT_RUN_PIPELINE_PREFIX,
} from "./events";
export { EXPERIMENT_RUN_STALLED_CODE } from "./experimentRunExecution.process";
export {
  experimentRunAggregateId,
  parseExperimentRunAggregateId,
} from "./schema";

const DEFAULT_RETENTION_DAYS = 308;

const runRowMapping = deriveRowMapping<
  ExperimentRunState,
  typeof experimentRunsTable.columns
>({
  table: experimentRunsTable,
  state: experimentRunStateSchema.omit({ targets: true }),
  key: ["RunId", "ExperimentId"],
  tenant: "TenantId",
  stateVersionColumn: "Version",
  fill: {
    ProjectionId: (state) => `${state.experimentId}:${state.runId}`,
    CreatedAt: () => new Date(),
    Targets: (state) => JSON.stringify(state.targets),
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

const runRowFromRow = (row: ExperimentRunsRow): ExperimentRunState => ({
  ...runRowMapping.fromRow(row),
  targets: decodeTargets(row.Targets),
});

/** One lane per run: two concurrent applies would race the fold's own
 * read-modify-write cycle (ADR-100 decision 2). */
export function experimentRunStateGroupKey(args: {
  readonly tenantId: string;
  readonly aggregateId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "experimentRunState" },
    scope: {
      kind: "aggregate",
      aggregateType: EXPERIMENT_RUN_PIPELINE_NAME,
      aggregateId: args.aggregateId,
    },
  };
}

/** One lane per dataset row, so an entry's target and evaluator results
 * coalesce into a single insert. */
export function experimentRunItemsGroupKey(args: {
  readonly tenantId: string;
  readonly experimentId: string;
  readonly runId: string;
  readonly index: number;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "experimentRunItems" },
    scope: {
      kind: "partition",
      parts: [args.experimentId, args.runId, String(args.index)],
    },
  };
}

/** The `experimentRunExecution` process manager's own lane, aggregate-scoped
 * to the run it watches. */
export function experimentRunExecutionGroupKey(args: {
  readonly tenantId: string;
  readonly aggregateId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "processManager", name: "experimentRunExecution" },
    scope: {
      kind: "aggregate",
      aggregateType: EXPERIMENT_RUN_PIPELINE_NAME,
      aggregateId: args.aggregateId,
    },
  };
}

/** Refuses an illegal mount at composition, not on the first delivery (ADR-106). */
function assertMountIsLegal(projection: string, mount: Mount): Mount {
  const violations = validateMount(mount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `experiment-run-processing's ${projection} mount is illegal: ${violations
        .map((v) => `${v.rule} — ${v.message}`)
        .join("; ")}`,
      { pipeline: EXPERIMENT_RUN_PIPELINE_NAME, projection, violations },
    );
  }
  return mount;
}

/** Structurally what `billing-reporting`'s `createPokeMount(...).handle`
 * already is — accepted by shape, never by importing that pipeline, so this
 * directory names no client belonging to another one (ADR-105 decision 6). */
export interface ExperimentRunBillingPoke {
  handle(event: { readonly tenantId: string }): Promise<void>;
}

export interface ExperimentRunProcessingDeps {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
  /** The `experimentRunState` fold's read-back cache tier. Absent means a
   *  ClickHouse point read on every delivery — deliberate, not an omission. */
  readonly cache?: FoldStateCache<ExperimentRunState>;
  /**
   * Required-but-nullable (ADR-102): every composition site has to say on
   * purpose whether stuck runs are watched, rather than silently getting no
   * reaper by omission. `null` means this deployment mounts no liveness
   * watchdog.
   */
  readonly experimentRunExecution: ExperimentRunExecutionDeps | null;
  /**
   * The billing usage poke, built by the composition root from the
   * billing-reporting pipeline's own `createPokeMount`. Absent means no
   * billing signal is dispatched from this pipeline's events — correct for a
   * self-hosted build, wrong for SaaS if forgotten.
   */
  readonly billingPoke?: ExperimentRunBillingPoke;
}

/** Mounts every projection beside the store it writes to. */
export function createExperimentRunProcessingPipeline(
  deps: ExperimentRunProcessingDeps,
) {
  const runStore = clickhouseReplacing({
    client: deps.client,
    table: experimentRunsTable,
    version: EXPERIMENT_RUN_STATE_VERSION_PIN,
    // The deployed engine key is composite: reading on `RunId` alone would
    // collapse two experiments that share a run slug, which run slugs do.
    key: {
      columns: ["RunId", "ExperimentId"],
      split: (key) => {
        const { experimentId, runId } = parseExperimentRunAggregateId(key);
        return [runId, experimentId];
      },
    },
    stateVersionColumn: "Version",
    row: { toRow: runRowMapping.toRow, fromRow: runRowFromRow },
    retentionDays: DEFAULT_RETENTION_DAYS,
    cache: deps.cache ?? noFoldStateCache(),
  });
  assertMountIsLegal("experimentRunState", {
    projection: "fold",
    store: runStore.kind,
    scope: "aggregate",
    collapse: "batch",
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
  assertMountIsLegal("experimentRunItems", {
    projection: "map",
    store: itemsStore.kind,
    scope: "partition",
    collapse: "batch",
  });

  const chain = definePipeline(EXPERIMENT_RUN_PIPELINE_NAME)
    .prefix(EXPERIMENT_RUN_PIPELINE_PREFIX)
    .events(experimentRunEvents)
    .id({
      started: experimentRunAggregateId,
      targetResult: experimentRunAggregateId,
      evaluatorResult: experimentRunAggregateId,
      completed: experimentRunAggregateId,
    })
    .withCommand("startExperimentRun", {
      input: experimentRunEvents.started,
      handle: startExperimentRun,
    })
    .withCommand("recordTargetResult", {
      input: experimentRunEvents.targetResult,
      handle: recordTargetResult,
    })
    .withCommand("recordEvaluatorResult", {
      input: experimentRunEvents.evaluatorResult,
      handle: recordEvaluatorResult,
    })
    .withCommand("completeExperimentRun", {
      input: experimentRunEvents.completed,
      handle: completeExperimentRun,
    })
    .withFold("experimentRunState", {
      state: experimentRunStateSchema,
      init: initExperimentRunState,
      pin: EXPERIMENT_RUN_STATE_VERSION_PIN,
      on: {
        started: applyRunStarted,
        completed: applyRunCompleted,
      },
      store: runStore,
    })
    .withMap("experimentRunItems", {
      on: {
        targetResult: mapTargetResult,
        evaluatorResult: mapEvaluatorResult,
      },
      store: itemsStore,
    })
    .withSubscriber("billingMeterPoke", {
      on: {
        started: (_data, ctx) =>
          deps.billingPoke?.handle({ tenantId: ctx.tenantId }),
        targetResult: (_data, ctx) =>
          deps.billingPoke?.handle({ tenantId: ctx.tenantId }),
        evaluatorResult: (_data, ctx) =>
          deps.billingPoke?.handle({ tenantId: ctx.tenantId }),
      },
    });

  const withExecution =
    deps.experimentRunExecution === null
      ? chain
      : chain.withProcessManager("experimentRunExecution", {
          state: experimentRunExecutionStateSchema,
          init: initExperimentRunExecutionState,
          intents: {
            failRun: {
              payload: experimentRunExecutionFailRunIntentSchema,
              messageKey: (payload) => `fail:${payload.runId}`,
              deliver: (payload, ctx) =>
                deliverExperimentRunExecutionFailRun(
                  payload,
                  ctx,
                  deps.experimentRunExecution!,
                ),
            },
          },
          on: {
            started: handleExperimentRunStarted,
            targetResult: handleExperimentRunTargetResult,
            evaluatorResult: handleExperimentRunEvaluatorResult,
            completed: handleExperimentRunCompleted,
          },
          onWake: onExperimentRunExecutionWake,
        });

  return withExecution.build({ metrics: deps.metrics });
}

export type ExperimentRunProcessingPipeline = ReturnType<
  typeof createExperimentRunProcessingPipeline
>;
