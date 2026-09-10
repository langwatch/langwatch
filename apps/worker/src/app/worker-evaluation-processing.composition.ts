import type { AnalyticsService } from "@langwatch/analytics-contract";
import {
  AutomationEvaluationSubscriberService,
  AutomationEvaluationTriggerFilterService,
  type AutomationEvaluationQueryClassification,
  type AutomationEvaluationTraceSummary,
  type AutomationGraphActivity,
  type AutomationTraceTriggerCatalogue,
  type AutomationTriggerMatchRecorder,
} from "@langwatch/automation-server";
import { RedisCachedFoldStore, type FoldProjectionStore } from "@langwatch/eventing";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import type {
  EvaluationProcessingEvent,
  ExecuteEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import {
  ClickHouseEvaluationRepository,
  DirectEvaluationExecutionReceiptAdapter,
  EvaluationEventingAdapter,
  EvaluationExecutionIntent,
  EvaluationExecutionIntentService,
  EvaluationExecution,
  EvaluationExecutionService,
  EvaluationRetentionFloor,
  EvaluationRunProjectionService,
  ExecuteEvaluationCommand,
  createEvaluationProcessingPipeline,
  type EvaluationAzureSafetyCredentials,
  type EvaluationCostRecorder,
  type EvaluationExecutionDeps,
  type EvaluationInputsOffload,
  type EvaluationMonitorLookup,
  type EvaluationSettingsRecovery,
  type EvaluationTraceEvidence,
} from "@langwatch/evaluation-server";
import type {
  EvaluationExecutionResult,
  ExecuteEvaluationCommand as ExecuteEvaluationCommandInput,
} from "@langwatch/evaluation-contract";
import { mappingStateSchema } from "@langwatch/dataset-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { EvaluationWorkerCapability } from "../features/evaluation/evaluation-worker-feature.installer.ts";
import { TraceAnalyticsAttributePolicy } from "../features/evaluation/evaluation-analytics-attribute-policy.adapter.ts";
import { createWorkerEvaluationClickHouseResolver } from "./worker-evaluation-app.composition.ts";

export abstract class WorkerEvaluationAbsenceReport {
  abstract withoutEvaluatorExecution(): void;
  abstract withoutExecutionReceiptLedger(): void;
}

/**
 * Everything the ONLINE evaluation path needs, handed in by the process.
 */
export type WorkerEvaluationExecutionCollaborators = Readonly<{
  /** The monitor the command names, and the trace its preconditions read. */
  monitors: EvaluationMonitorLookup;
  evidence: EvaluationTraceEvidence;
  azureSafetyCredentials: EvaluationAzureSafetyCredentials;
  settingsRecovery: EvaluationSettingsRecovery;
  inputsOffload: EvaluationInputsOffload;
  /** Where the run is billed. */
  costs: EvaluationCostRecorder;
  /** The engine: trace reads, mappings, the evaluator call. */
  engine: EvaluationExecutionDeps;
}>;

/**
 * The two collaborators Automation's evaluation subscribers reach, plus the recorder they write
 * matches through.
 */
export type WorkerEvaluationAutomationMembers = Readonly<{
  triggers: AutomationTraceTriggerCatalogue;
  graphActivity: AutomationGraphActivity;
  triggerMatches: AutomationTriggerMatchRecorder;
}>;

export type WorkerEvaluationProcessingOptions = Readonly<{
  /** The deployment's tenant-keyed ClickHouse client. */
  resolveClickHouseClient: EventingClickHouseClientResolver;
  /** The number the event store already stamps its own rows with. */
  defaultRetentionDays: number;
  /** The analytics capability this process composes once, for every feature. */
  analytics: AnalyticsService;
  /** The one trace reader this process composes: summary read and classifier. */
  traces: AutomationEvaluationTraceSummary & AutomationEvaluationQueryClassification;
  automation: WorkerEvaluationAutomationMembers;
  /** The queue's own Redis, or nothing on a deployment that configured none. */
  redis?: RedisConnection | null;
  /** `LANGWATCH_FOLD_CACHE_TTL_SECONDS`, read once by the process. */
  foldCacheTtlSeconds?: number;
  absence?: WorkerEvaluationAbsenceReport;
  execution?: WorkerEvaluationExecutionCollaborators;
}>;

/**
 * Evaluation's worker graph after its durable pipeline and direct execution
 * capability have been composed. The application-facing Evaluation service
 * reuses `execution`; it never constructs a second evaluator engine.
 */
export type WorkerEvaluationProcessing = EvaluationWorkerCapability<EvaluationProcessingEvent> &
  Readonly<{ execution?: EvaluationExecution }>;

/**
 * Evaluation's durable processing pipeline, composed from this process's own
 * substrates: commands, the ClickHouse run projection, the Redis-cached
 * analytics fold, and the automation trigger-match reactor.
 */
export function createWorkerEvaluationProcessing(
  options: WorkerEvaluationProcessingOptions & {
    execution: WorkerEvaluationExecutionCollaborators;
  },
): WorkerEvaluationProcessing & Readonly<{ execution: EvaluationExecution }>;
export function createWorkerEvaluationProcessing(
  options: WorkerEvaluationProcessingOptions,
): WorkerEvaluationProcessing;
export function createWorkerEvaluationProcessing(
  options: WorkerEvaluationProcessingOptions,
): WorkerEvaluationProcessing {
  const stores = EvaluationEventingAdapter.create({
    evaluation: EvaluationRunProjectionService.create({
      repository: ClickHouseEvaluationRepository.create({
        resolveClient: createWorkerEvaluationClickHouseResolver(options.resolveClickHouseClient),
        retentionFloor: new WorkerEvaluationRetentionFloor(options.defaultRetentionDays),
      }),
    }),
    analytics: options.analytics,
    attributePolicy: new TraceAnalyticsAttributePolicy(),
    retentionDays: options.defaultRetentionDays,
  }).buildStores();

  const execution = createEvaluationExecutionIntent(options);

  const automations = AutomationEvaluationSubscriberService.create({
    triggers: options.automation.triggers,
    graphActivity: options.automation.graphActivity,
    traces: options.traces,
    evaluationFilters: AutomationEvaluationTriggerFilterService.create(options.traces),
    triggerMatches: options.automation.triggerMatches,
  });

  return {
    ...(execution.direct ? { execution: execution.direct } : {}),
    buildProcessing: () =>
      createEvaluationProcessingPipeline({
        evalRunStore: stores.evalRunStore,
        evaluationAnalyticsStore: cached(
          stores.evaluationAnalyticsStore,
          "evaluation_analytics",
          options,
        ),
        evaluationAnalyticsRollupAppendStore: stores.evaluationAnalyticsRollupAppendStore,
        executeEvaluationCommand: ExecuteEvaluationCommand.create(execution.intent),
        automations,
      }),
  };
}

/**
 * The ONLINE path, composed for real when the process handed in the whole bundle and refused by
 * name when it did not.
 */
function createEvaluationExecutionIntent(options: WorkerEvaluationProcessingOptions): Readonly<{
  intent: EvaluationExecutionIntent;
  direct?: EvaluationExecution;
}> {
  const collaborators = options.execution;
  if (!collaborators) {
    options.absence?.withoutEvaluatorExecution();
    return { intent: new AbsentEvaluatorExecution() };
  }

  options.absence?.withoutExecutionReceiptLedger();
  const engine = EvaluationExecutionService.create(collaborators.engine);

  const direct = new WorkerEvaluationEngine(engine);
  const intent = EvaluationExecutionIntentService.create({
    monitors: collaborators.monitors,
    traces: collaborators.evidence,
    azureSafetyCredentials: collaborators.azureSafetyCredentials,
    settingsRecovery: collaborators.settingsRecovery,
    inputsOffload: collaborators.inputsOffload,
    executionReceipt: DirectEvaluationExecutionReceiptAdapter.create({
      execution: direct,
      costs: collaborators.costs,
    }),
  });

  return { intent, direct };
}

/**
 * Adapts the engine's own call shape to the port the receipt drives. The one translation is the
 * mappings: the command carries them as an opaque record because a queue payload is JSON, and the
 * engine reads a parsed `MappingState`.
 */
class WorkerEvaluationEngine extends EvaluationExecution {
  #engine: EvaluationExecutionService;

  constructor(engine: EvaluationExecutionService) {
    super();
    this.#engine = engine;
  }

  execute(input: ExecuteEvaluationCommandInput): Promise<EvaluationExecutionResult> {
    return this.#engine.executeForTrace({
      ...input,
      mappings: input.mappings === null ? null : mappingStateSchema.parse(input.mappings),
    });
  }
}

class AbsentEvaluatorExecution extends EvaluationExecutionIntent {
  execute(input: ExecuteEvaluationCommandData): Promise<never> {
    return Promise.reject(
      new Error(
        `This process cannot run evaluator ${input.evaluatorType} for evaluation ${input.evaluationId}: online evaluation resolves the project's model provider and renders the trace through the application's own mapping layer, neither of which is composable here.`,
      ),
    );
  }
}

/**
 * The floor a run read will not look below, derived from the one retention default this process
 * configures its event store with. The same class the settlement reader uses, for the same reason:
 * a second number would let the fold read back runs the writer had already expired.
 */
class WorkerEvaluationRetentionFloor extends EvaluationRetentionFloor {
  #defaultRetentionDays: number;

  constructor(defaultRetentionDays: number) {
    super();
    this.#defaultRetentionDays = defaultRetentionDays;
  }

  async getFloorMs(): Promise<number> {
    return Date.now() - this.#defaultRetentionDays * 24 * 60 * 60 * 1000;
  }
}

function cached<State>(
  durable: FoldProjectionStore<State>,
  keyPrefix: string,
  options: { redis?: RedisConnection | null; foldCacheTtlSeconds?: number },
): FoldProjectionStore<State> {
  if (!options.redis) return durable;

  return new RedisCachedFoldStore<State>(durable, options.redis, {
    keyPrefix,
    ...(options.foldCacheTtlSeconds === undefined
      ? {}
      : { ttlSeconds: options.foldCacheTtlSeconds }),
  });
}
