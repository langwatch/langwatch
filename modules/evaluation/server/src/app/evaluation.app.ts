import {
  AZURE_SAFETY_ENV_VARS,
  AZURE_SAFETY_PROVIDER_KEY,
  EvaluationApi,
  isAzureEvaluatorType,
  type CustomEvaluator,
  type DatasetEvaluationRow,
  type EvaluationApi as EvaluationApiContract,
  type EvaluationCostRecord,
  type EvaluationModelLookup,
  type EvaluationMonitorSummary,
  type EvaluationProjectScope,
  type EvaluationRunOutcome,
  type EvaluationSlugLookup,
  type EvaluationSlugMatch,
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
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import { generate } from "@langwatch/ksuid";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { nowInstant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";

import type {
  EvaluationClickHouseResolver,
  EvaluationExecutionPort,
  EvaluationInputsResolutionPort,
  EvaluationRetentionFloorPort,
} from "../ports/evaluation.port.ts";
import type {
  EvaluationCustomEvaluatorsPort,
  EvaluationInstallEnvironmentPort,
  EvaluationReportPort,
  EvaluationRescorePort,
  EvaluationRunAnalyticsPort,
  EvaluationWarmupPort,
} from "../ports/evaluation-rescore.port.ts";
import { ClickHouseEvaluationRepository } from "../repositories/clickhouse/evaluation.repository.ts";
import { ClickHouseMonitorPerformanceRepository } from "../repositories/clickhouse/monitor-performance.repository.ts";
import type { EvaluationRepositories } from "../repositories/evaluation.repositories.ts";
import {
  EvaluationBatchLogService,
  type EvaluationExperimentDirectory,
  type EvaluationExperimentRunWriter,
} from "../services/evaluation-batch-log.service.ts";
import { EvaluationNameAutoslugService } from "../services/evaluation-name-autoslug.service.ts";
import { EvaluatorAvailabilityService } from "../services/evaluator-availability.service.ts";
import { EvaluationService } from "../services/evaluation.service.ts";

export type EvaluationInfrastructure = Readonly<{
  resolveClickHouse: EvaluationClickHouseResolver;
  retentionFloor: EvaluationRetentionFloorPort;
  execution: EvaluationExecutionPort;
  inputResolution: EvaluationInputsResolutionPort;
  environment: EvaluationInstallEnvironmentPort;
  customEvaluators: EvaluationCustomEvaluatorsPort;
  rescore: EvaluationRescorePort;
  warmup: EvaluationWarmupPort;
  analytics: EvaluationRunAnalyticsPort;
  report: EvaluationReportPort;
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
  typeof EvaluationApp.dependencies,
  EvaluationInfrastructure,
  undefined,
  EvaluationRepositories
>;

const logger = createLogger("langwatch:evaluation:app");

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
export class EvaluationApp implements EvaluationApiContract {
  static readonly contract = EvaluationApi;
  static readonly dependencies = {
    workflows: WorkflowApi,
    traces: TraceApi,
    modelProviders: ModelProviderApi,
  };

  readonly #service: EvaluationService;
  readonly #modelProviders: ModelProviderApi;
  readonly #environment: EvaluationInstallEnvironmentPort;
  readonly #customEvaluators: EvaluationCustomEvaluatorsPort;
  readonly #rescore: EvaluationRescorePort;
  readonly #warmup: EvaluationWarmupPort;
  readonly #analytics: EvaluationRunAnalyticsPort;
  readonly #report: EvaluationReportPort;
  readonly #batchLog: EvaluationBatchLogService;
  readonly #autoslug: EvaluationNameAutoslugService;
  readonly #experiments: EvaluationExperimentDirectory;
  readonly #slugs: EvaluationSlugDirectory;
  readonly #savedEvaluators: EvaluationSavedEvaluatorDirectory;
  readonly #models: EvaluationModelCascade;
  readonly #ledger: EvaluationLedger;
  readonly #runner: EvaluationRunner;

  private constructor(
    service: EvaluationService,
    dependencies: EvaluationSetup["dependencies"],
    infrastructure: EvaluationInfrastructure,
  ) {
    this.#service = service;
    this.#modelProviders = dependencies.modelProviders;
    this.#environment = infrastructure.environment;
    this.#customEvaluators = infrastructure.customEvaluators;
    this.#rescore = infrastructure.rescore;
    this.#warmup = infrastructure.warmup;
    this.#analytics = infrastructure.analytics;
    this.#report = infrastructure.report;
    this.#experiments = infrastructure.experiments;
    this.#slugs = infrastructure.slugs;
    this.#savedEvaluators = infrastructure.savedEvaluators;
    this.#models = infrastructure.models;
    this.#ledger = infrastructure.ledger;
    this.#runner = infrastructure.runner;
    this.#autoslug = EvaluationNameAutoslugService.create();
    this.#batchLog = EvaluationBatchLogService.create({
      experiments: infrastructure.experiments,
      runs: infrastructure.experimentRuns,
      report: infrastructure.report,
    });
  }

  static create({ infrastructure, dependencies }: EvaluationSetup): EvaluationApp {
    const repository = ClickHouseEvaluationRepository.create({
      resolveClient: infrastructure.resolveClickHouse,
      retentionFloor: infrastructure.retentionFloor,
    });
    const monitorPerformance = ClickHouseMonitorPerformanceRepository.create({
      resolveClient: infrastructure.resolveClickHouse,
    });

    return new EvaluationApp(
      EvaluationService.create({
        repository,
        monitorPerformance,
        execution: infrastructure.execution,
        inputResolution: infrastructure.inputResolution,
        workflows: dependencies.workflows,
      }),
      dependencies,
      infrastructure,
    );
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
  findInputs: EvaluationApiContract["findInputs"] = (input) =>
    this.#service.findInputs(input);
  getMonitorPerformance: EvaluationApiContract["getMonitorPerformance"] = (input) =>
    this.#service.getMonitorPerformance(input);

  logBatchEvaluation: EvaluationApiContract["logBatchEvaluation"] = (input) =>
    this.#batchLog.log(input);
  runEvaluator: EvaluationApiContract["runEvaluator"] = (input) =>
    this.#runner.runEvaluation(input);
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
  deriveEvaluatorId: EvaluationApiContract["deriveEvaluatorId"] = (name) =>
    this.#autoslug.derive(name);

  async reportEvaluation(data: ReportEvaluationCommandData): Promise<void> {
    await this.#report.reportEvaluation(data);
  }

  async listEvaluators(input: EvaluationProjectScope): Promise<EvaluatorCatalogue> {
    // Azure Safety evaluators resolve their credentials solely from the
    // project's azure_safety model provider. There is no environment fallback,
    // so an unconfigured provider reports them as missing. Resolved once and
    // reused for all three Azure evaluator types.
    const azureMissing = (await this.#azureSafetyCredentials(input.projectId))
      ? []
      : [...AZURE_SAFETY_ENV_VARS];
    const environment = this.#environment.read();
    const catalogue: EvaluatorCatalogue = {};

    for (const [key, evaluator] of Object.entries(AVAILABLE_EVALUATORS)) {
      const unavailable = EvaluatorAvailabilityService.findUnavailability({
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
    const result = await this.#rescore.runForTrace(input);

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

  /**
   * Azure Content Safety credentials for a project, resolved solely from its
   * `azure_safety` model provider, or null when it is not configured.
   * @see specs/evaluators/azure-safety-byok-gating.feature
   */
  async #azureSafetyCredentials(projectId: string): Promise<Record<string, string> | null> {
    const providers = await this.#modelProviders.getExecutionProviders({ projectId });
    const provider = providers[AZURE_SAFETY_PROVIDER_KEY];
    if (!provider?.enabled) return null;

    const endpoint = provider.customKeys?.AZURE_CONTENT_SAFETY_ENDPOINT;
    const key = provider.customKeys?.AZURE_CONTENT_SAFETY_KEY;
    if (typeof endpoint !== "string" || endpoint.trim() === "") return null;
    if (typeof key !== "string" || key.trim() === "") return null;

    return { AZURE_CONTENT_SAFETY_ENDPOINT: endpoint, AZURE_CONTENT_SAFETY_KEY: key };
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
