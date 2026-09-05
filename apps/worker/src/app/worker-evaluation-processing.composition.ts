import type { AnalyticsService } from "@langwatch/analytics-contract";
import {
  AutomationEvaluationSubscriberService,
  AutomationEvaluationTriggerFilterService,
  type AutomationEvaluationQueryClassificationPort,
  type AutomationEvaluationTraceSummaryPort,
  type AutomationGraphActivityPort,
  type AutomationTraceTriggerCataloguePort,
  type AutomationTriggerMatchRecorderPort,
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
  EvaluationExecutionIntentPort,
  EvaluationExecutionIntentService,
  EvaluationExecutionPort,
  EvaluationExecutionService,
  EvaluationRetentionFloorPort,
  EvaluationRunProjectionService,
  ExecuteEvaluationCommand,
  createEvaluationProcessingPipeline,
  type EvaluationAzureSafetyCredentialsPort,
  type EvaluationCostRecorderPort,
  type EvaluationExecutionDeps,
  type EvaluationInputsOffloadPort,
  type EvaluationMonitorLookupPort,
  type EvaluationSettingsRecoveryPort,
  type EvaluationTraceEvidencePort,
} from "@langwatch/evaluation-server";
import type {
  EvaluationExecutionResult,
  ExecuteEvaluationCommand as ExecuteEvaluationCommandInput,
} from "@langwatch/evaluation-contract";
import { mappingStateSchema } from "@langwatch/trace-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { EvaluationWorkerCapability } from "../features/evaluation/evaluation-worker-feature.installer";
import { TraceAnalyticsAttributePolicy } from "../features/evaluation/evaluation-analytics-attribute-policy.adapter";

/**
 * Reports the composition decision an unrunnable evaluator would otherwise hide.
 */
export abstract class WorkerEvaluationAbsenceReportPort {
  abstract withoutEvaluatorExecution(): void;

  /**
   * Reported when the online path IS composed but its durable execution receipt is not: a
   * redelivery after a crash calls the evaluator a second time.
   */
  abstract withoutExecutionReceiptLedger(): void;
}

/**
 * Everything the ONLINE evaluation path needs, handed in by the process.
 */
export type WorkerEvaluationExecutionCollaborators = Readonly<{
  /** The monitor the command names, and the trace its preconditions read. */
  monitors: EvaluationMonitorLookupPort;
  evidence: EvaluationTraceEvidencePort;
  azureSafetyCredentials: EvaluationAzureSafetyCredentialsPort;
  settingsRecovery: EvaluationSettingsRecoveryPort;
  inputsOffload: EvaluationInputsOffloadPort;
  /** Where the run is billed. */
  costs: EvaluationCostRecorderPort;
  /** The engine: trace reads, mappings, the evaluator call. */
  engine: EvaluationExecutionDeps;
}>;

/**
 * The two collaborators Automation's evaluation subscribers reach, plus the recorder they write
 * matches through.
 */
export type WorkerEvaluationAutomationPorts = Readonly<{
  triggers: AutomationTraceTriggerCataloguePort;
  graphActivity: AutomationGraphActivityPort;
  triggerMatches: AutomationTriggerMatchRecorderPort;
}>;

export type WorkerEvaluationProcessingOptions = Readonly<{
  /** The deployment's tenant-keyed ClickHouse client. */
  resolveClickHouseClient: EventingClickHouseClientResolver;
  /** The number the event store already stamps its own rows with. */
  defaultRetentionDays: number;
  /** The analytics capability this process composes once, for every feature. */
  analytics: AnalyticsService;
  /** The one trace reader this process composes: summary read and classifier. */
  traces: AutomationEvaluationTraceSummaryPort & AutomationEvaluationQueryClassificationPort;
  automation: WorkerEvaluationAutomationPorts;
  /** The queue's own Redis, or nothing on a deployment that configured none. */
  redis?: RedisConnection | null;
  /** `LANGWATCH_FOLD_CACHE_TTL_SECONDS`, read once by the process. */
  foldCacheTtlSeconds?: number;
  absence?: WorkerEvaluationAbsenceReportPort;
  /** Absent on a process that cannot run an evaluator itself. */
  execution?: WorkerEvaluationExecutionCollaborators;
}>;

/**
 * Evaluation's durable processing pipeline, composed from this process's own
 * substrates: commands, the ClickHouse run projection, the Redis-cached
 * analytics fold, and the automation trigger-match reactor.
 */
export function createWorkerEvaluationProcessing(
  options: WorkerEvaluationProcessingOptions,
): EvaluationWorkerCapability<EvaluationProcessingEvent> {
  const stores = EvaluationEventingAdapter.create({
    evaluation: EvaluationRunProjectionService.create({
      repository: ClickHouseEvaluationRepository.create({
        resolveClient: options.resolveClickHouseClient as unknown as Parameters<
          typeof ClickHouseEvaluationRepository.create
        >[0]["resolveClient"],
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
    buildProcessing: () =>
      createEvaluationProcessingPipeline({
        evalRunStore: stores.evalRunStore,
        evaluationAnalyticsStore: cached(
          stores.evaluationAnalyticsStore,
          "evaluation_analytics",
          options,
        ),
        evaluationAnalyticsRollupAppendStore: stores.evaluationAnalyticsRollupAppendStore,
        executeEvaluationCommand: ExecuteEvaluationCommand.create(execution),
        automations,
      }),
  };
}

/**
 * The ONLINE path, composed for real when the process handed in the whole bundle and refused by
 * name when it did not.
 */
function createEvaluationExecutionIntent(
  options: WorkerEvaluationProcessingOptions,
): EvaluationExecutionIntentPort {
  const collaborators = options.execution;
  if (!collaborators) {
    options.absence?.withoutEvaluatorExecution();

    return new AbsentEvaluatorExecution();
  }

  options.absence?.withoutExecutionReceiptLedger();

  const engine = EvaluationExecutionService.create(collaborators.engine);

  return EvaluationExecutionIntentService.create({
    monitors: collaborators.monitors,
    traces: collaborators.evidence,
    azureSafetyCredentials: collaborators.azureSafetyCredentials,
    settingsRecovery: collaborators.settingsRecovery,
    inputsOffload: collaborators.inputsOffload,
    executionReceipt: DirectEvaluationExecutionReceiptAdapter.create({
      execution: new WorkerEvaluationEngine(engine),
      costs: collaborators.costs,
    }),
  });
}

/**
 * Adapts the engine's own call shape to the port the receipt drives. The one translation is the
 * mappings: the command carries them as an opaque record because a queue payload is JSON, and the
 * engine reads a parsed `MappingState`.
 */
class WorkerEvaluationEngine extends EvaluationExecutionPort {
  constructor(private readonly engine: EvaluationExecutionService) {
    super();
  }

  execute(input: ExecuteEvaluationCommandInput): Promise<EvaluationExecutionResult> {
    return this.engine.executeForTrace({
      ...input,
      mappings: input.mappings === null ? null : mappingStateSchema.parse(input.mappings),
    });
  }
}

/**
 * The one named absence: running the evaluator. The command class itself is real — its schema,
 * aggregate id, span attributes and the job id that deduplicates a thread's evaluations are all the
 * package's own, so the routing key is claimed and a redelivery still collapses onto one job.
 */
class AbsentEvaluatorExecution extends EvaluationExecutionIntentPort {
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
class WorkerEvaluationRetentionFloor extends EvaluationRetentionFloorPort {
  constructor(private readonly defaultRetentionDays: number) {
    super();
  }

  async getFloorMs(): Promise<number> {
    return Date.now() - this.defaultRetentionDays * 24 * 60 * 60 * 1000;
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
