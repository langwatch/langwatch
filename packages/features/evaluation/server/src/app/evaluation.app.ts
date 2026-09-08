import {
  AZURE_SAFETY_ENV_VARS,
  AZURE_SAFETY_PROVIDER_KEY,
  EvaluationApi,
  isAzureEvaluatorType,
  type CustomEvaluator,
  type EvaluationApi as EvaluationApiContract,
  type EvaluationProjectScope,
  type EvaluationRunOutcome,
  type EvaluationWarmup,
  type EvaluatorCatalogue,
  type RunTraceEvaluationInput,
  type WarmupEvaluatorsInput,
} from "@langwatch/evaluation-contract";
import { AVAILABLE_EVALUATORS } from "@langwatch/evaluator-contract";
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
}>;

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
  tryGetRunByEvaluationId: EvaluationApiContract["tryGetRunByEvaluationId"] = (input) =>
    this.#service.tryGetRunByEvaluationId(input);
  findRunsByTraceId: EvaluationApiContract["findRunsByTraceId"] = (input) =>
    this.#service.findRunsByTraceId(input);
  findSummariesByTraceIds: EvaluationApiContract["findSummariesByTraceIds"] = (input) =>
    this.#service.findSummariesByTraceIds(input);
  findTraceEvaluations: EvaluationApiContract["findTraceEvaluations"] = (input) =>
    this.#service.findTraceEvaluations(input);
  tryGetInputs: EvaluationApiContract["tryGetInputs"] = (input) =>
    this.#service.tryGetInputs(input);
  getMonitorPerformance: EvaluationApiContract["getMonitorPerformance"] = (input) =>
    this.#service.getMonitorPerformance(input);

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
