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
  EvaluationEventingAdapter,
  EvaluationExecutionIntentPort,
  EvaluationRetentionFloorPort,
  EvaluationRunProjectionService,
  ExecuteEvaluationCommand,
  createEvaluationProcessingPipeline,
} from "@langwatch/evaluation-server";
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
}

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

  options.absence?.withoutEvaluatorExecution();

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
        executeEvaluationCommand: ExecuteEvaluationCommand.create(new AbsentEvaluatorExecution()),
        automations,
      }),
  };
}

/**
 * The one named absence: running the evaluator.
 *
 * The command class itself is real — its schema, aggregate id, span attributes
 * and the job id that deduplicates a thread's evaluations are all the
 * package's own, so the routing key is claimed and a redelivery still collapses
 * onto one job. What refuses is the INTENT behind it, and it refuses by name.
 *
 * WHY IT CANNOT BE COMPOSED HERE. Running an online evaluation resolves the
 * customer's model provider and their managed-provider credentials, renders
 * the trace through the application's own mapping layer, and calls out to the
 * evaluator service; the model-provider cascade alone is a capability this
 * process cannot build. An intent that guessed at any of those would bill a
 * customer's key against a provider they did not choose, or score a trace
 * against inputs they did not map.
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
