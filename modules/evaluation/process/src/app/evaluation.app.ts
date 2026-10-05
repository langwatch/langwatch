import { AnalyticsApi } from "@langwatch/analytics-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { DatasetApi } from "@langwatch/dataset-contract";
import {
  AZURE_SAFETY_ENV_VARS,
  EvaluationApi,
  evaluationBrowserConfig,
  evaluationConfig,
  isAzureEvaluatorType,
  type CustomEvaluator,
  type EvaluationServerConfig,
  type DatasetEvaluationRow,
  type EvaluationApi as EvaluationApiContract,
  type EvaluationCostRecord,
  type EvaluationModelLookup,
  type EvaluationMonitorSummary,
  type EvaluationProjectScope,
  type EvaluationRunOutcome,
  type EvaluationSlugLookup,
  type EvaluationSlugMatch,
  type ExecuteEvaluationCommandData,
  type ReportEvaluationCommandData,
  type RunEvaluatorInput,
  type SavedEvaluatorLookup,
  type SavedEvaluatorResolution,
  type EvaluationWarmup,
  type EvaluatorCatalogue,
  type RunTraceEvaluationInput,
  type WarmupEvaluatorsInput,
} from "@langwatch/evaluation-contract";
import {
  AVAILABLE_EVALUATORS,
  EvaluatorApi,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import type { EventingCommands } from "@langwatch/eventing";
import { ExperimentApi } from "@langwatch/experiment-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { generate } from "@langwatch/ksuid";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { MonitorApi } from "@langwatch/monitor-contract";
import { createLogger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/process";
import { type MembersRead } from "@langwatch/process-stores/members";
import { openAiApiKey, Secret } from "@langwatch/secrets";
import { nowInstant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";

import { langevalsChannels } from "../channels/langevals-channels.registry.ts";
import { NullLangevalsChannel } from "../channels/null.langevals.channel.ts";
import { ObjectStorageLangevalsPayloadStaging } from "../channels/object-storage.langevals-payload-staging.channel.ts";
import { ExecuteEvaluationCommand } from "../eventing/evaluation-execution.intent.ts";
import type { EvaluationLifecyclePipeline } from "../eventing/evaluation-lifecycle.pipeline.ts";
import {
  EvaluationProcessingPipelineAdapter,
  type EvaluationProcessingPipeline,
} from "../eventing/evaluation-processing-definition.pipeline.ts";
import { EvaluationProcessingStoresAdapter } from "../eventing/evaluation-processing-stores.pipeline.ts";
import type { EvaluationRepositories } from "../repositories/evaluation.repositories.ts";
import type { EvaluationRetentionLookup } from "../repositories/evaluation.repository.ts";
import { findUnavailability } from "../rules/evaluator-availability-service.rules.ts";
import { AzureSafetyCredentialsService } from "../services/azure-safety-credentials.service.ts";
import {
  EvaluationBatchLogService,
  type EvaluationExperimentDirectory,
  type EvaluationExperimentRunWriter,
} from "../services/evaluation-batch-log.service.ts";
import { EvaluationCommandDispatcherService } from "../services/evaluation-command-dispatcher.service.ts";
import { EvaluationCostService } from "../services/evaluation-cost.service.ts";
import { EvaluationDatasetLookupService } from "../services/evaluation-dataset-lookup.service.ts";
import { EvaluationExecutionIntentService } from "../services/evaluation-execution-intent.service.ts";
import { EvaluationExecutionMetricsService } from "../services/evaluation-execution-metrics.service.ts";
import { EvaluationExecutionReceiptService } from "../services/evaluation-execution-receipt.service.ts";
import { EvaluationExecutionService } from "../services/evaluation-execution.service.ts";
import { EvaluationExperimentRunService } from "../services/evaluation-experiment-run.service.ts";
import { EvaluationFilterMatchingService } from "../services/evaluation-filter-matching.service.ts";
import { EvaluationGuardrailCheckService } from "../services/evaluation-guardrail-check.service.ts";
import { FlaggedEvaluationInputsOffloadService } from "../services/evaluation-inputs-offload-switch.service.ts";
import {
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
  EvaluationInputsOffloadService,
} from "../services/evaluation-inputs-offload.service.ts";
import { EvaluationLifecycleService } from "../services/evaluation-lifecycle.service.ts";
import { EvaluationModelCascadeService } from "../services/evaluation-model-cascade.service.ts";
import { EvaluationMonitorLookupService } from "../services/evaluation-monitor-lookup.service.ts";
import { EvaluationNameAutoslugService } from "../services/evaluation-name-autoslug.service.ts";
import { EvaluationRetentionDaysService } from "../services/evaluation-retention-days.service.ts";
import { EvaluationRunProjectionService } from "../services/evaluation-run-projection.service.ts";
import { EvaluationSavedEvaluatorService } from "../services/evaluation-saved-evaluator.service.ts";
import { EvaluationSettingsRecoverySwitchService } from "../services/evaluation-settings-recovery-switch.service.ts";
import { EvaluationSpanDigestService } from "../services/evaluation-span-digest.service.ts";
import { EvaluationService } from "../services/evaluation.service.ts";
import { EvaluatorEnvironmentService } from "../services/evaluator-environment.service.ts";
import { EvaluatorModelEnvService } from "../services/evaluator-model-env.service.ts";
import { EvaluatorOwnSettingsService } from "../services/evaluator-own-settings.service.ts";
import { EvaluatorSettingsService } from "../services/evaluator-settings.service.ts";
import { LangevalsClusteringService } from "../services/langevals-clustering.service.ts";
import { LangevalsEvaluatorService } from "../services/langevals-evaluator.service.ts";
import { LangevalsPiiDetectionService } from "../services/langevals-pii-detection.service.ts";
import { WorkflowEvaluationService } from "../services/workflow-evaluation.service.ts";

export type EvaluationInfrastructure = Readonly<{
  retention: EvaluationRetentionLookup;
  execution: Pick<EvaluationExecutionService, "execute">;
  inputResolution: Pick<EvaluationInputsOffloadService, "resolveInputs">;
  environment: Pick<EvaluatorEnvironmentService, "read">;
  customEvaluators: EvaluationCustomEvaluators;
  rescore: EvaluationRescore;
  warmup: EvaluationWarmupProbe;
  analytics: EvaluationRunAnalytics;
  report: Pick<EvaluationCommandDispatcherService, "reportEvaluation">;
  // What the public evaluation doors reach beyond the module: the experiment
  // an SDK batch is written into, the rows a slug names, the saved-evaluator
  // directory, the model cascade, the cost ledger and the evaluator runtime.
  experiments: EvaluationExperimentDirectory;
  experimentRuns: EvaluationExperimentRunWriter;
  slugs: EvaluationSlugDirectory;
  savedEvaluators: EvaluationSavedEvaluatorDirectory;
  models: EvaluationModelCascade;
  ledger: EvaluationLedger;
  runner: EvaluationRunner;
}>;

/** Closed evaluation capabilities for a process that installs reads but no evaluator runtime. */
function createUnavailableEvaluationInfrastructure(processName: string): EvaluationInfrastructure {
  const unavailable = (capability: string): never => {
    throw new Error(`${processName} composes no ${capability}`);
  };

  return {
    retention: {
      getPlatformDefaultRetentionDays: () => unavailable("data retention"),
      findRetentionDays: async () => [],
    },
    execution: { execute: async () => unavailable("evaluation executor") },
    inputResolution: { resolveInputs: async (input) => input.inputs },
    environment: { read: () => ({}) },
    customEvaluators: { findAll: async () => [] },
    rescore: { runForTrace: async () => unavailable("trace evaluation runtime") },
    warmup: { probe: async () => unavailable("evaluator warmup runtime") },
    analytics: { evaluationRan: () => void 0 },
    report: { reportEvaluation: async () => unavailable("evaluation report pipeline") },
    experiments: {
      findOrCreate: async () => unavailable("experiment directory"),
      findBySlug: async () => unavailable("experiment directory"),
    },
    experimentRuns: {
      startRun: async () => unavailable("experiment run writer"),
      recordTargetResult: async () => unavailable("experiment run writer"),
      recordEvaluatorResult: async () => unavailable("experiment run writer"),
      completeRun: async () => unavailable("experiment run writer"),
    },
    slugs: {
      findMonitorBySlug: async () => unavailable("monitor directory"),
      findDatasetBySlug: async () => unavailable("dataset directory"),
    },
    savedEvaluators: {
      resolveForExecution: async () => unavailable("saved evaluator directory"),
    },
    models: { findModelForFeature: async () => null },
    ledger: {
      recordCost: async () => unavailable("evaluation cost ledger"),
      recordDatasetRow: async () => unavailable("evaluation cost ledger"),
    },
    runner: { runEvaluation: async () => unavailable("evaluator runtime") },
  };
}

/** The project's own workflow-backed evaluators, each with its published version. */
export interface EvaluationCustomEvaluators {
  findAll(input: Readonly<{ projectId: string }>): Promise<CustomEvaluator[]>;
}

/** Scores one stored trace with one evaluator, read through the caller's protections. */
export interface EvaluationRescore {
  runForTrace(
    input: RunTraceEvaluationInput,
    by: Readonly<{ id: string }>,
  ): Promise<EvaluationRunOutcome>;
}

/**
 * One liveness probe at the evaluator backend. A failed probe is not an error,
 * only a probe that did not warm anything.
 */
export interface EvaluationWarmupProbe {
  probe(input: Readonly<{ projectId: string }>): Promise<void>;
}

/** Product analytics for a completed run. */
export interface EvaluationRunAnalytics {
  evaluationRan(input: Readonly<{ userId: string; projectId: string }>): void;
}

/** The monitors and datasets an evaluate call addresses by slug. */
export interface EvaluationSlugDirectory {
  findMonitorBySlug(input: EvaluationSlugLookup): Promise<EvaluationMonitorSummary | null>;
  findDatasetBySlug(input: EvaluationSlugLookup): Promise<EvaluationSlugMatch | null>;
}

/** The saved-evaluator directory the `evaluators/{slug|id}` form resolves on. */
export interface EvaluationSavedEvaluatorDirectory {
  resolveForExecution(input: SavedEvaluatorLookup): Promise<SavedEvaluatorResolution>;
}

/**
 * The project's model cascade. Null rather than a thrown "not configured": the
 * caller's only answer to an unconfigured cascade is the evaluator's own
 * default, so the exception the cascade raises has no consumer on this path.
 */
export interface EvaluationModelCascade {
  findModelForFeature(input: EvaluationModelLookup): Promise<string | null>;
}

/** Where a run's cost and a dataset evaluation's rows are written. */
export interface EvaluationLedger {
  recordCost(input: EvaluationCostRecord): Promise<EvaluationSlugMatch>;
  recordDatasetRow(input: DatasetEvaluationRow): Promise<void>;
}

/** The one evaluator runtime this process composed. */
export interface EvaluationRunner {
  runEvaluation(input: RunEvaluatorInput): Promise<SingleEvaluationResult>;
}

type EvaluationSetup = FeatureSetup<
  typeof EvaluationModule.dependencies,
  MembersRead<typeof EvaluationModule.reads>,
  EvaluationServerConfig,
  EvaluationRepositories
>;

/**
 * This process composes no evaluator runtime of its own: the module answers
 * every capability by name rather than reading a bespoke member.
 */
const EVALUATION_PROCESS_NAME = "the evaluation module";

const logger = createLogger("langwatch:evaluation:app");

const LANGEVALS_MAX_RETRIES = 1;
const LANGEVALS_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The KSUID resource prefix a re-evaluation's id carries — the app's
 * `KSUID_RESOURCES.EVALUATION`.
 */
const EVALUATION_KSUID_RESOURCE = "eval";

/** The verdict fields, gated on the run actually completing. */
function verdictOf(
  result: EvaluationRunOutcome,
): Readonly<{ score?: number; passed?: boolean; label?: string }> {
  if (result.status !== "processed") return {};

  return {
    score: typeof result.score === "number" ? result.score : undefined,
    passed: result.passed ?? undefined,
    label: result.label ?? undefined,
  };
}

/** The one process-owned Evaluation capability. */
export class EvaluationModule implements EvaluationApiContract {
  static readonly contract = EvaluationApi;
  /** `langevalsEndpoint`: where this deployment's evaluator and clustering service answers. */
  static readonly config = evaluationConfig;
  static readonly publicConfig = evaluationBrowserConfig.project;
  static readonly dependencies = {
    workflows: WorkflowApi,
    traces: TraceApi,
    modelProviders: ModelProviderApi,
    /** Owns the platform default retention the run reads are floored at, read per lookup. */
    retention: DataRetentionApi,
    featureFlags: FeatureFlagApi,
    evaluators: EvaluatorApi,
    /** Read per request (queued runs, slug lookups), not in construction: monitor needs us. */
    monitors: MonitorApi,
    /** Where the analytics folds and rollup are written. */
    analytics: AnalyticsApi,
    /** The dataset a dataset evaluation names by slug, and the batch-evaluation rows it writes. */
    datasets: DatasetApi,
    /** The experiment and run history SDK batches and dataset evaluations are written into. */
    experiments: ExperimentApi,
  };
  static readonly reads = ["objectStorage"] as const;
  static readonly secrets = {
    openAi: openAiApiKey,
    azureContentSafety: Secret.load("AZURE_CONTENT_SAFETY_KEY", { optional: true }),
  } as const;

  readonly #service: EvaluationService;
  readonly #azureSafety: AzureSafetyCredentialsService;
  readonly #environment: Pick<EvaluatorEnvironmentService, "read">;
  readonly #customEvaluators: EvaluationCustomEvaluators;
  readonly #rescore: EvaluationRescore;
  readonly #warmup: EvaluationWarmupProbe;
  readonly #analytics: EvaluationRunAnalytics;
  readonly #report: Pick<EvaluationCommandDispatcherService, "reportEvaluation">;
  readonly #batchLog: EvaluationBatchLogService;
  readonly #autoslug: EvaluationNameAutoslugService;
  readonly #filterMatching: EvaluationFilterMatchingService;
  readonly #ownSettings: EvaluatorOwnSettingsService;
  readonly #experiments: EvaluationExperimentDirectory;
  readonly #slugs: EvaluationSlugDirectory;
  readonly #savedEvaluators: EvaluationSavedEvaluatorDirectory;
  readonly #models: EvaluationModelCascade;
  readonly #ledger: EvaluationLedger;
  readonly #runner: EvaluationRunner;
  readonly #guardrails: EvaluationGuardrailCheckService;
  readonly #commands: EvaluationCommandDispatcherService | undefined;
  readonly #clustering: LangevalsClusteringService;
  readonly #piiDetection: LangevalsPiiDetectionService;
  readonly #executionIntent: Pick<EvaluationExecutionIntentService, "execute">;
  readonly #eventing: EvaluationProcessingStoresAdapter;
  readonly #lifecycle: EvaluationLifecycleService | undefined;

  private constructor({
    service,
    dependencies,
    members,
    commands,
    clustering,
    piiDetection,
    executionIntent,
    eventing,
    lifecycle,
  }: {
    service: EvaluationService;
    dependencies: EvaluationSetup["dependencies"];
    members: EvaluationInfrastructure;
    commands: EvaluationCommandDispatcherService | undefined;
    clustering: LangevalsClusteringService;
    piiDetection: LangevalsPiiDetectionService;
    executionIntent: Pick<EvaluationExecutionIntentService, "execute">;
    eventing: EvaluationProcessingStoresAdapter;
    lifecycle: EvaluationLifecycleService | undefined;
  }) {
    this.#service = service;
    this.#lifecycle = lifecycle;
    this.#clustering = clustering;
    this.#piiDetection = piiDetection;
    this.#executionIntent = executionIntent;
    this.#eventing = eventing;
    this.#azureSafety = AzureSafetyCredentialsService.create(dependencies.modelProviders);
    this.#environment = members.environment;
    this.#customEvaluators = members.customEvaluators;
    this.#rescore = members.rescore;
    this.#warmup = members.warmup;
    this.#analytics = members.analytics;
    this.#report = members.report;
    this.#experiments = members.experiments;
    this.#slugs = members.slugs;
    this.#savedEvaluators = members.savedEvaluators;
    this.#models = members.models;
    this.#ledger = members.ledger;
    this.#runner = members.runner;
    this.#guardrails = EvaluationGuardrailCheckService.create({
      runner: members.runner,
      ledger: members.ledger,
    });
    this.#commands = commands;
    this.#autoslug = EvaluationNameAutoslugService.create();
    this.#filterMatching = EvaluationFilterMatchingService.create();
    this.#ownSettings = EvaluatorOwnSettingsService.create({
      evaluators: dependencies.evaluators,
      settings: EvaluatorSettingsService.create(),
      settingsRecovery: EvaluationSettingsRecoverySwitchService.create(dependencies.featureFlags),
    });
    this.#batchLog = EvaluationBatchLogService.create({
      experiments: members.experiments,
      runs: members.experimentRuns,
      report: members.report,
    });
  }

  /** The closed stub answers what has no port yet (see the port-evaluation-runtime handoff). */
  static async create(setup: EvaluationSetup): Promise<EvaluationModule> {
    const { secrets } = setup;
    const environment = await secrets.into(EvaluationModule.secrets.openAi, (openAi) =>
      secrets.into(EvaluationModule.secrets.azureContentSafety, (azureContentSafety) =>
        EvaluatorEnvironmentService.create({
          config: setup.config,
          openAiApiKey: openAi,
          azureContentSafetyKey: azureContentSafety,
        }),
      ),
    );

    return EvaluationModule.withEnvironment(setup, environment);
  }

  private static withEnvironment(
    { dependencies, repositories, members, config }: EvaluationSetup,
    environment: EvaluatorEnvironmentService,
  ): EvaluationModule {
    const commands = EvaluationCommandDispatcherService.create();
    const lifecycle = EvaluationLifecycleService.create();
    const langevals = config.langevalsEndpoint
      ? langevalsChannels.live.create({
          config,
          staging: ObjectStorageLangevalsPayloadStaging.create({
            objectStorage: members.objectStorage,
          }),
        })
      : NullLangevalsChannel.create();
    const telemetry = EvaluationExecutionMetricsService.create();
    const unavailable = createUnavailableEvaluationInfrastructure(EVALUATION_PROCESS_NAME);
    const monitorLookup = EvaluationMonitorLookupService.create(dependencies.monitors);
    const datasets = EvaluationDatasetLookupService.create(dependencies.datasets);
    const experiments = EvaluationExperimentRunService.create(dependencies.experiments);
    const costs = EvaluationCostService.create({ repository: repositories.costs });
    const azureSafety = AzureSafetyCredentialsService.create(dependencies.modelProviders);
    const inputs = EvaluationInputsOffloadService.create({
      storage: repositories.inputs,
      config: {
        inlineMaxBytes: EVAL_INPUTS_INLINE_MAX_BYTES,
        hardCeilingBytes: EVAL_INPUTS_HARD_CEILING_BYTES,
        previewBytes: EVAL_INPUTS_PREVIEW_BYTES,
      },
    });
    const execution = EvaluationExecutionService.create({
      traces: dependencies.traces,
      spanDigest: EvaluationSpanDigestService.create(dependencies.traces),
      modelEnvResolver: EvaluatorModelEnvService.create({
        modelProviders: dependencies.modelProviders,
        azureSafety,
        environment,
      }),
      langevalsClient: LangevalsEvaluatorService.create({
        langevals,
        config: {
          endpoint: config.langevalsEndpoint,
          maxRetries: LANGEVALS_MAX_RETRIES,
          timeoutMs: LANGEVALS_TIMEOUT_MS,
        },
        telemetry,
      }),
      workflows: dependencies.workflows,
      evaluators: dependencies.evaluators,
      workflowExecutor: WorkflowEvaluationService.create(dependencies.workflows),
      installEnvironment: environment.read(),
      telemetry,
    });

    return EvaluationModule.fromInfrastructure({
      infrastructure: {
        ...unavailable,
        customEvaluators: {
          findAll: (input) => dependencies.workflows.findEvaluatorWorkflows(input),
        },
        experiments,
        experimentRuns: experiments,
        slugs: {
          findMonitorBySlug: (input) => monitorLookup.findMonitorBySlug(input),
          findDatasetBySlug: (input) => datasets.findDatasetBySlug(input),
        },
        savedEvaluators: EvaluationSavedEvaluatorService.create(dependencies.evaluators),
        models: EvaluationModelCascadeService.create(dependencies.modelProviders),
        ledger: {
          recordCost: (input) => costs.recordEntry(input),
          recordDatasetRow: (input) => datasets.recordDatasetRow(input),
        },
        retention: EvaluationRetentionDaysService.create(dependencies.retention),
        execution,
        inputResolution: inputs,
        environment,
        analytics: { evaluationRan: (input) => void lifecycle.ran(input) },
        report: commands,
        rescore: {
          runForTrace: async (input, by) =>
            execution.rescoreTrace({
              input,
              protections: await dependencies.traces.resolveViewerProtections({
                projectId: input.projectId,
                userId: by.id,
              }),
            }),
        },
        runner: { runEvaluation: (input) => execution.executeForData(input) },
        warmup: {
          probe: ({ projectId }) =>
            dependencies.workflows.postStudioEvent({
              projectId,
              event: { type: "is_alive", payload: {} },
              onEvent: () => void 0,
            }),
        },
      },
      dependencies,
      repositories,
      commands,
      lifecycle,
      clustering: LangevalsClusteringService.create({
        endpoint: config.langevalsEndpoint,
        langevals,
      }),
      piiDetection: LangevalsPiiDetectionService.create({
        endpoint: config.langevalsEndpoint,
        langevals,
      }),
      executionIntent: EvaluationExecutionIntentService.create({
        monitors: dependencies.monitors,
        traces: dependencies.traces,
        azureSafetyCredentials: azureSafety,
        settingsRecovery: EvaluationSettingsRecoverySwitchService.create(dependencies.featureFlags),
        inputsOffload: FlaggedEvaluationInputsOffloadService.create({
          inputs,
          flags: dependencies.featureFlags,
        }),
        executionReceipt: EvaluationExecutionReceiptService.create({
          execution,
          costs,
        }),
      }),
      eventing: EvaluationProcessingStoresAdapter.create({
        runs: EvaluationRunProjectionService.create({
          repository: repositories.runs,
          retention: EvaluationRetentionDaysService.create(dependencies.retention),
        }),
        analytics: dependencies.analytics,
        analyticsFoldCache: repositories.analyticsFoldCache,
        defaultRetentionDays: () => dependencies.retention.getPlatformDefaultRetentionDays(),
        tenantRetention: {
          resolve: (tenantId) =>
            dependencies.retention.getResolvedForProject({ projectId: tenantId }),
        },
      }),
    });
  }

  static fromInfrastructure(setup: {
    infrastructure: EvaluationInfrastructure;
    dependencies: EvaluationSetup["dependencies"];
    repositories: Pick<EvaluationRepositories, "runs" | "monitorPerformance">;
    commands?: EvaluationCommandDispatcherService;
    /** Absent where a suite composes none; the app then holds no lifecycle pipeline. */
    lifecycle?: EvaluationLifecycleService;
    clustering: LangevalsClusteringService;
    piiDetection: LangevalsPiiDetectionService;
    executionIntent: Pick<EvaluationExecutionIntentService, "execute">;
    eventing: EvaluationProcessingStoresAdapter;
  }): EvaluationModule {
    const {
      infrastructure: members,
      dependencies,
      repositories,
      commands,
      lifecycle,
      clustering,
      piiDetection,
      executionIntent,
      eventing,
    } = setup;

    return new EvaluationModule({
      service: EvaluationService.create({
        repository: repositories.runs,
        monitorPerformance: repositories.monitorPerformance,
        retention: members.retention,
        execution: members.execution,
        inputResolution: members.inputResolution,
        workflows: dependencies.workflows,
      }),
      dependencies,
      members,
      commands,
      lifecycle,
      clustering,
      piiDetection,
      executionIntent,
      eventing,
    });
  }

  /** evaluation_processing: run and analytics folds, execute intent, automation reactions. */
  eventingPipeline(): EvaluationProcessingPipeline {
    return EvaluationProcessingPipelineAdapter.createPipeline({
      ...this.#eventing.buildStores(),
      executeEvaluationCommand: ExecuteEvaluationCommand.create(this.#executionIntent),
      ...(this.#lifecycle ? { lifecycle: this.#lifecycle } : {}),
    });
  }

  /** The pipeline `evaluation_lifecycle` registers, built once by {@link create}. */
  lifecyclePipeline(): EvaluationLifecyclePipeline {
    if (!this.#lifecycle) {
      throw new Error("This evaluation app was composed without a lifecycle pipeline");
    }

    return this.#lifecycle.pipeline;
  }

  /** Binds the lifecycle pipeline's own senders. */
  connectLifecycleCommands(commands: EventingCommands<EvaluationLifecyclePipeline>): void {
    if (!this.#lifecycle) {
      throw new Error("This evaluation app was composed without a lifecycle pipeline");
    }
    this.#lifecycle.connect(commands);
  }

  /** Binds evaluation_processing's own senders; `reportEvaluation` goes through them. */
  connectCommands(commands: EventingCommands<EvaluationProcessingPipeline>): void {
    if (!this.#commands) throw new Error("this evaluation app was composed with its own report");
    this.#commands.connect(commands);
  }

  executeForTrace: EvaluationApiContract["executeForTrace"] = (input) =>
    this.#service.executeForTrace(input);
  upsertRun: EvaluationApiContract["upsertRun"] = (input) => this.#service.upsertRun(input);
  upsertRuns: EvaluationApiContract["upsertRuns"] = (input) => this.#service.upsertRuns(input);
  getRunByEvaluationId: EvaluationApiContract["getRunByEvaluationId"] = (input) =>
    this.#service.getRunByEvaluationId(input);
  findRunByEvaluationId: EvaluationApiContract["findRunByEvaluationId"] = (input) =>
    this.#service.findRunByEvaluationId(input);
  findRunsByTraceId: EvaluationApiContract["findRunsByTraceId"] = (input) =>
    this.#service.findRunsByTraceId(input);
  findSummariesByTraceIds: EvaluationApiContract["findSummariesByTraceIds"] = (input) =>
    this.#service.findSummariesByTraceIds(input);
  findTraceEvaluations: EvaluationApiContract["findTraceEvaluations"] = (input) =>
    this.#service.findTraceEvaluations(input);
  findInputs: EvaluationApiContract["findInputs"] = (input) => this.#service.findInputs(input);
  getMonitorPerformance: EvaluationApiContract["getMonitorPerformance"] = (input) =>
    this.#service.getMonitorPerformance(input);

  logBatchEvaluation: EvaluationApiContract["logBatchEvaluation"] = (input) =>
    this.#batchLog.log(input);
  runEvaluator: EvaluationApiContract["runEvaluator"] = (input) =>
    this.#runner.runEvaluation(input);
  checkGuardrail: EvaluationApiContract["checkGuardrail"] = (input) =>
    this.#guardrails.check(input);
  resolveSavedEvaluator: EvaluationApiContract["resolveSavedEvaluator"] = (input) =>
    this.#savedEvaluators.resolveForExecution(input);
  findMonitorBySlug: EvaluationApiContract["findMonitorBySlug"] = (input) =>
    this.#slugs.findMonitorBySlug(input);
  findDatasetBySlug: EvaluationApiContract["findDatasetBySlug"] = (input) =>
    this.#slugs.findDatasetBySlug(input);
  findExperimentBySlug: EvaluationApiContract["findExperimentBySlug"] = (input) =>
    this.#experiments.findBySlug(input);
  findModelForFeature: EvaluationApiContract["findModelForFeature"] = (input) =>
    this.#models.findModelForFeature(input);
  recordEvaluationCost: EvaluationApiContract["recordEvaluationCost"] = (input) =>
    this.#ledger.recordCost(input);
  recordDatasetEvaluationRow: EvaluationApiContract["recordDatasetEvaluationRow"] = (input) =>
    this.#ledger.recordDatasetRow(input);
  findEvaluatorOwnSettings: EvaluationApiContract["findEvaluatorOwnSettings"] = (input) =>
    this.#ownSettings.find(input);
  deriveEvaluatorId: EvaluationApiContract["deriveEvaluatorId"] = (name) =>
    this.#autoslug.derive(name);
  matchesEvaluationFilters: EvaluationApiContract["matchesEvaluationFilters"] = (input) =>
    this.#filterMatching.matchesEvaluationFilters(input);
  requestTopicClustering: EvaluationApiContract["requestTopicClustering"] = (input) =>
    this.#clustering.request(input);
  detectPii: EvaluationApiContract["detectPii"] = (input) => this.#piiDetection.detect(input);

  async reportEvaluation(data: ReportEvaluationCommandData): Promise<void> {
    await this.#report.reportEvaluation(data);
  }

  async queueTraceEvaluation(data: ExecuteEvaluationCommandData): Promise<void> {
    if (!this.#commands) throw new Error("this evaluation app was composed with its own report");
    await this.#commands.queueTraceEvaluation(data);
  }

  async listEvaluators(input: EvaluationProjectScope): Promise<EvaluatorCatalogue> {
    // Azure Safety evaluators resolve their credentials solely from the
    // project's azure_safety model provider. There is no environment fallback,
    // so an unconfigured provider reports them as missing. Resolved once and
    // reused for all three Azure evaluator types.
    const azure = await this.#azureSafety.resolveForTenant({ tenantId: input.projectId });
    const azureMissing = azure.kind === "configured" ? [] : [...AZURE_SAFETY_ENV_VARS];
    const environment = this.#environment.read();
    const catalogue: EvaluatorCatalogue = {};

    for (const [key, evaluator] of Object.entries(AVAILABLE_EVALUATORS)) {
      const unavailable = findUnavailability({
        evaluatorType: key,
        environment,
      });

      catalogue[key] = {
        ...evaluator,
        missingEnvVars: isAzureEvaluatorType(key)
          ? azureMissing
          : [...evaluator.envVars].filter((name) => !environment[name]),
        ...(unavailable ? { unavailable } : {}),
      };
    }

    return catalogue;
  }

  listCustomEvaluators(input: EvaluationProjectScope): Promise<CustomEvaluator[]> {
    return this.#customEvaluators.findAll({ projectId: input.projectId });
  }

  async runTraceEvaluation(
    input: RunTraceEvaluationInput,
    by: Readonly<{ id: string }>,
  ): Promise<EvaluationRunOutcome> {
    const result = await this.#rescore.runForTrace(input, by);

    this.#analytics.evaluationRan({ userId: by.id, projectId: input.projectId });
    await this.#reportRescore({ input, result });

    return result;
  }

  async warmupEvaluators(input: WarmupEvaluatorsInput): Promise<EvaluationWarmup> {
    logger.debug(
      { projectId: input.projectId, count: input.count },
      "Warming up evaluator runtime instances",
    );

    await Promise.allSettled(
      Array.from({ length: input.count }, () => this.#probe(input.projectId)),
    );

    return { success: true, count: input.count };
  }

  /** One warmup probe, its failure swallowed: a cold runtime is a nudge, not a request. */
  #probe(projectId: string): Promise<void> {
    return this.#warmup.probe({ projectId }).catch((error: unknown) => {
      logger.debug({ error, projectId }, "Evaluator runtime warmup request failed");
    });
  }

  /** Puts the on-demand run on the pipeline every other verdict travels on. */
  async #reportRescore(params: {
    input: RunTraceEvaluationInput;
    result: EvaluationRunOutcome;
  }): Promise<void> {
    const { input, result } = params;
    const evaluationId = generate(EVALUATION_KSUID_RESOURCE).toString();

    try {
      await this.#report.reportEvaluation({
        tenantId: input.projectId,
        evaluationId,
        evaluatorId: input.evaluatorType,
        evaluatorType: input.evaluatorType,
        traceId: input.traceId,
        status: result.status,
        ...verdictOf(result),
        details: "details" in result ? result.details : undefined,
        error: result.status === "error" ? result.details : undefined,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      logger.warn(
        { error, evaluationId, evaluatorType: input.evaluatorType },
        "Failed to dispatch single re-evaluation to the evaluation processing pipeline",
      );
    }
  }
}
