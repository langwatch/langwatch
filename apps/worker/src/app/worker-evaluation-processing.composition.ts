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
  DirectEvaluationExecutionReceipt,
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
 * Reports the composition decision an unrunnable evaluator would otherwise
 * hide.
 *
 * Stated at boot rather than inferred from a command that always throws: the
 * pipeline mounts either way, so every routing key stays claimed and every
 * evaluation reported by a customer's own SDK is still folded, rolled up and
 * alerted on. What is absent is the ONLINE path — the one where LangWatch runs
 * the evaluator itself.
 */
export abstract class WorkerEvaluationAbsenceReportPort {
  abstract withoutEvaluatorExecution(): void;

  /**
   * Reported when the online path IS composed but its durable execution
   * receipt is not: a redelivery after a crash calls the evaluator a second
   * time. The cost row is unaffected — the recorder derives its id from the
   * operation key — so this is a duplicated provider call, not duplicated
   * spend.
   */
  abstract withoutExecutionReceiptLedger(): void;
}

/**
 * Everything the ONLINE evaluation path needs, handed in by the process.
 *
 * It is one bundle rather than eight options because the path is all-or-
 * nothing: an execution that could read the trace but not resolve the model
 * would score against inputs the customer did not map, and one that could call
 * the evaluator but not read the monitor would run whatever the command
 * happened to name. A process that cannot build all of it composes none of it
 * and says so at boot.
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
 * The two collaborators Automation's evaluation subscribers reach, plus the
 * recorder they write matches through.
 *
 * Named as three ports rather than as `AutomationService` because that is what
 * the two handlers actually call: the project's active trace triggers, one
 * graph re-evaluation, and the durable match write. `AutomationService`
 * satisfies all three, so the application's own composition would be
 * unchanged; this process composes each over what it already holds.
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
 * substrates.
 *
 *     command:startEvaluation      EvaluationCommandAdapter     (no collaborators)
 *     command:completeEvaluation   EvaluationCommandAdapter
 *     command:reportEvaluation     EvaluationCommandAdapter
 *     command:executeEvaluation    ExecuteEvaluationCommand ── ABSENT INTENT
 *     projection:evaluationRun     EvaluationRunProjectionService ─ ClickHouse
 *     projection:evaluationAnalytics  RedisCachedFoldStore("evaluation_analytics")
 *     handler:evaluationAnalyticsRollup  append-only, never cached
 *     reactor:triggerMatch         AutomationEvaluationSubscriberService
 *     subscriber:graphTriggerActivity            "
 *
 * THE ANALYTICS CACHE PREFIX IS A WIRE CONTRACT, for the same reason Trace's
 * two are: while both graphs ingest, either process may advance an
 * evaluation's analytics fold, and both read the warm tier out of the same
 * Redis keyspace. `evaluation_analytics` is a literal here rather than
 * anything derived — a prefix spelled differently would not fail, it would
 * give this process its own empty cache and lose the shared applied-event-id
 * set that stops a redelivered batch folding twice.
 *
 * THE RUN STORE IS THE THREE-METHOD PROJECTION SERVICE, not `EvaluationService`.
 * The fold stores a run row and reads one back; the capability around it
 * additionally demands an evaluator executor and the whole Workflow service,
 * so composing it here would mean naming two collaborators this path provably
 * never calls.
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
 * The ONLINE path, composed for real when the process handed in the whole
 * bundle and refused by name when it did not.
 *
 * The chain is the package's own: `EvaluationExecutionIntentService` prepares
 * (monitor lookup, sampling, preconditions, settings recovery), the receipt
 * runs `EvaluationExecutionService` and bills it, and the outcome service turns
 * what came back into the reported event. Nothing here re-implements a step —
 * this composition only says which substrate each one runs on.
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
    executionReceipt: DirectEvaluationExecutionReceipt.create({
      execution: new WorkerEvaluationEngine(engine),
      costs: collaborators.costs,
    }),
  });
}

/**
 * Adapts the engine's own call shape to the port the receipt drives.
 *
 * The one translation is the mappings: the command carries them as an opaque
 * record because a queue payload is JSON, and the engine reads a parsed
 * `MappingState`. Parsing here rather than inside the engine keeps the refusal
 * at the boundary the malformed row actually crosses.
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
 * The one named absence: running the evaluator.
 *
 * The command class itself is real — its schema, aggregate id, span attributes
 * and the job id that deduplicates a thread's evaluations are all the
 * package's own, so the routing key is claimed and a redelivery still collapses
 * onto one job. What refuses is the INTENT behind it, and it refuses by name.
 *
 * WHY IT CANNOT BE COMPOSED HERE, exactly. It is no longer the model-provider
 * cascade: this process composes its own gateway, and the bridge an execution
 * reads its `X_LITELLM_*` environment through is written and sits in
 * `worker-evaluation-model-env.composition.ts`. Four things are genuinely
 * missing, and every one of them is load-bearing for a correct score:
 *
 *   - the EVALUATOR CATALOG. `EvaluationExecutionService` takes an
 *     `EvaluatorService`, and `@langwatch/evaluator-server` is not a dependency
 *     of this process.
 *   - the MONITOR READ BY ID. This process composes `MonitorCatalogService`,
 *     whose one method lists a project's enabled monitors; resolving ONE by id
 *     lives on the wide `MonitorService`, which itself wants the evaluator
 *     catalog above.
 *   - the TRACE EVIDENCE reads. `getEvaluationSpans` and
 *     `getEvaluationEvents` exist only on the eight-collaborator
 *     `TraceService`, which this process does not build.
 *   - SETTINGS RECOVERY and INPUTS OFFLOAD. Both are declared ports with no
 *     implementation anywhere in the tree, in any process.
 *
 * An intent that guessed at any of those would bill a customer's key against a
 * provider they did not choose, or score a trace against inputs they did not
 * map.
 *
 * A THROW RATHER THAN A SKIP, deliberately. A skipped evaluation is a real
 * outcome in this pipeline — it folds, it rolls up, and it can satisfy an
 * alert — so answering "skipped" here would tell a customer their evaluation
 * ran and found nothing. Throwing returns the job to the queue, which is the
 * same shape every other absent executor in this process takes.
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
 * The floor a run read will not look below, derived from the one retention
 * default this process configures its event store with.
 *
 * The same class the settlement reader uses, for the same reason: a second
 * number would let the fold read back runs the writer had already expired.
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
