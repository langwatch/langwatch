import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { defineModule, type FeatureSetup } from "@langwatch/runtime-composition";
import { TraceApi } from "@langwatch/trace-contract";
import type {
  WorkflowEnvironmentDecryptor,
  NlpPayloadStagingPort,
} from "@langwatch/workflow-server";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import type { RedisConnection } from "@langwatch/redis-client";
import type {
  AutomationEvaluationQueryClassificationPort,
  AutomationEvaluationTraceSummaryPort,
  AutomationGraphActivityPort,
  AutomationTraceTriggerCataloguePort,
  AutomationTriggerMatchRecorderPort,
} from "@langwatch/automation-server";
import type { WorkerModelProviders } from "./worker-model-provider.composition.ts";
import type { WorkerObjectStorage } from "./worker-object-storage.composition.ts";
import {
  createWorkerEvaluationApp,
  createWorkerEvaluationWorkflows,
} from "./worker-evaluation-app.composition.ts";
import { createWorkerEvaluationExecutionCollaborators } from "./worker-evaluation-execution.composition.ts";
import {
  createWorkerEvaluationProcessing,
  type WorkerEvaluationProcessing,
} from "./worker-evaluation-processing.composition.ts";

export type WorkerEvaluationInfrastructure = Readonly<{
  database: PrismaClient;
  /** The ONE dataset application this process installed. */
  datasets: DatasetApi;
  /** The ONE monitor application this process installed. */
  monitors: MonitorApi;
  modelProviders: ModelProviderService;
  models: WorkerModelProviders;
  secretDecryptor: WorkflowEnvironmentDecryptor;
  nlpServiceUrl: string | undefined;
  payloadStaging: NlpPayloadStagingPort;
  featureFlags: FeatureFlagApi;
  storage: WorkerObjectStorage;
  langevalsEndpoint: string | undefined;
  evaluationEnvironment: Readonly<Record<string, string | undefined>>;
  resolveClickHouseClient: EventingClickHouseClientResolver;
  defaultRetentionDays: number;
  analytics: AnalyticsService;
  traces: AutomationEvaluationTraceSummaryPort & AutomationEvaluationQueryClassificationPort;
  automation: Readonly<{
    triggers: AutomationTraceTriggerCataloguePort;
    graphActivity: AutomationGraphActivityPort;
    triggerMatches: AutomationTriggerMatchRecorderPort;
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
 * The worker's Evaluation declaration. Trace and Evaluation can name one
 * another because boot preallocates their API clients before either setup runs.
 */
const workerEvaluationApp = {
  contract: EvaluationApi,
  dependencies: { traces: TraceApi },
  create({
    dependencies,
    infrastructure,
    resources,
  }: FeatureSetup<
    Readonly<{ traces: typeof TraceApi }>,
    WorkerEvaluationInfrastructure,
    undefined
  >) {
    const workflows = createWorkerEvaluationWorkflows({
      database: infrastructure.database,
      datasets: infrastructure.datasets,
      modelProviders: infrastructure.modelProviders,
      secretDecryptor: infrastructure.secretDecryptor,
      nlpServiceUrl: infrastructure.nlpServiceUrl,
      payloadStaging: infrastructure.payloadStaging,
    });
    const execution = createWorkerEvaluationExecutionCollaborators({
      database: infrastructure.database,
      traces: dependencies.traces,
      monitors: infrastructure.monitors,
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

export const workerEvaluationServer = defineModule("evaluation")
  .withApp(workerEvaluationApp)
  .build();
