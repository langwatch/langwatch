import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import { MonitorApi } from "@langwatch/monitor-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { defineServerModule, type FeatureSetup } from "@langwatch/runtime-composition";
import { TraceApi } from "@langwatch/trace-contract";
import type {
  WorkflowEnvironmentDecryptor,
  NlpPayloadStaging,
} from "@langwatch/workflow-server";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import type { RedisConnection } from "@langwatch/redis-client";
import type {
  AutomationEvaluationQueryClassification,
  AutomationEvaluationTraceSummary,
  AutomationGraphActivity,
  AutomationTraceTriggerCatalogue,
  AutomationTriggerMatchRecorder,
} from "@langwatch/automation-server";
import type { WorkerModelProviders } from "./worker-model-provider.composition.ts";
import type { WorkerObjectStorage } from "./worker-object-storage.composition.ts";
import {
  createWorkerEvaluationApp,
  type WorkerEvaluationWorkflows,
} from "./worker-evaluation-app.composition.ts";
import { createWorkerEvaluationExecutionCollaborators } from "./worker-evaluation-execution.composition.ts";
import {
  createWorkerEvaluationProcessing,
  type WorkerEvaluationProcessing,
} from "./worker-evaluation-processing.composition.ts";

export type WorkerEvaluationInfrastructure = Readonly<{
  database: PrismaClient;
  /** The ONE workflow graph this process installed, and the engine behind it. */
  workflows: WorkerEvaluationWorkflows;
  /** The ONE dataset application this process installed. */
  datasets: DatasetApi;
  modelProviders: ModelProviderApi;
  models: WorkerModelProviders;
  secretDecryptor: WorkflowEnvironmentDecryptor;
  nlpServiceUrl: string | undefined;
  payloadStaging: NlpPayloadStaging;
  featureFlags: FeatureFlagApi;
  storage: WorkerObjectStorage;
  langevalsEndpoint: string | undefined;
  evaluationEnvironment: Readonly<Record<string, string | undefined>>;
  resolveClickHouseClient: EventingClickHouseClientResolver;
  defaultRetentionDays: number;
  analytics: AnalyticsService;
  traces: AutomationEvaluationTraceSummary & AutomationEvaluationQueryClassification;
  automation: Readonly<{
    triggers: AutomationTraceTriggerCatalogue;
    graphActivity: AutomationGraphActivity;
    triggerMatches: AutomationTriggerMatchRecorder;
  }>;
  redis?: RedisConnection | null;
  foldCacheTtlSeconds?: number;
  processing: WorkerEvaluationProcessingResult;
}>;

/** A process-owned handoff from feature setup to its pipeline installer. */
export class WorkerEvaluationProcessingResult {
  #processing: WorkerEvaluationProcessing | undefined;

  resolve(processing: WorkerEvaluationProcessing): void {
    this.#processing = processing;
  }

  tryGet(): WorkerEvaluationProcessing | undefined {
    return this.#processing;
  }
}

/**
 * The worker's Evaluation declaration, built over the process-specific bag the
 * composition root closes in. The v2 builder supplies no bespoke bag, so the
 * factory carries it by closure; peers still arrive as declared dependencies,
 * and Trace and Evaluation can name one another because boot preallocates
 * their API clients before either setup runs.
 */
function workerEvaluationApp(infrastructure: WorkerEvaluationInfrastructure) {
  return {
  contract: EvaluationApi,
  dependencies: { traces: TraceApi, monitors: MonitorApi, evaluators: EvaluatorApi },
  create({
    dependencies,
    resources,
  }: FeatureSetup<
    Readonly<{ traces: typeof TraceApi; monitors: typeof MonitorApi; evaluators: typeof EvaluatorApi }>,
    never,
    undefined
  >) {
    const workflows = infrastructure.workflows;
    const execution = createWorkerEvaluationExecutionCollaborators({
      database: infrastructure.database,
      traces: dependencies.traces,
      monitors: dependencies.monitors,
      evaluators: dependencies.evaluators,
      workflows,
      models: infrastructure.models,
      featureFlags: infrastructure.featureFlags,
      storage: infrastructure.storage,
      langevalsEndpoint: infrastructure.langevalsEndpoint,
      environment: infrastructure.evaluationEnvironment,
    });
    const processing = createWorkerEvaluationProcessing({
      resolveClickHouseClient: infrastructure.resolveClickHouseClient,
      defaultRetentionDays: infrastructure.defaultRetentionDays,
      analytics: infrastructure.analytics,
      traces: infrastructure.traces,
      automation: infrastructure.automation,
      ...(infrastructure.redis === undefined ? {} : { redis: infrastructure.redis }),
      ...(infrastructure.foldCacheTtlSeconds === undefined
        ? {}
        : { foldCacheTtlSeconds: infrastructure.foldCacheTtlSeconds }),
      execution,
    });
    const composed = createWorkerEvaluationApp({
      resolveClickHouseClient: infrastructure.resolveClickHouseClient,
      defaultRetentionDays: infrastructure.defaultRetentionDays,
      execution: processing.execution,
      workflows: workflows.workflows,
      traces: dependencies.traces,
      inputResolution: execution.inputResolution,
      resources,
    });
    infrastructure.processing.resolve(processing);
    return composed.evaluations;
  },
  };
}

/** One evaluation module per composed bag; install the SAME instance you read. */
export function createWorkerEvaluationServer(infrastructure: WorkerEvaluationInfrastructure) {
  return defineServerModule("evaluation").withApp(workerEvaluationApp(infrastructure)).build();
}
