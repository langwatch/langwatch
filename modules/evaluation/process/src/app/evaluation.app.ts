import { DataRetentionApi } from "@langwatch/data-retention-contract";
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
import { AVAILABLE_EVALUATORS, type SingleEvaluationResult } from "@langwatch/evaluator-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type { FeatureSetup } from "@langwatch/kernel";
import { generate } from "@langwatch/ksuid";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { nowInstant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";

import type {
  EvaluationCustomEvaluators,
  EvaluationInstallEnvironment,
  EvaluationReport,
  EvaluationRescore,
  EvaluationRunAnalytics,
  EvaluationWarmupProbe,
} from "../app/evaluation.members.ts";
import type { EvaluationRepositories } from "../repositories/evaluation.repositories.ts";
import { findUnavailability } from "../rules/evaluator-availability-service.rules.ts";
import {
  EvaluationBatchLogService,
  type EvaluationExperimentDirectory,
  type EvaluationExperimentRunWriter,
} from "../services/evaluation-batch-log.service.ts";
import { EvaluationCommandDispatcherService } from "../services/evaluation-command-dispatcher.service.ts";
import { EvaluationNameAutoslugService } from "../services/evaluation-name-autoslug.service.ts";
import type { EvaluationProcessingPipeline } from "../services/evaluation-processing.service.ts";
import { EvaluationRetentionFloorService } from "../services/evaluation-retention-floor.service.ts";
import { EvaluationService } from "../services/evaluation.service.ts";
import type {
  EvaluationExecution,
  EvaluationInputsResolution,
  EvaluationRetentionFloor,
} from "./evaluation.members.ts";

export type EvaluationInfrastructure = Readonly<{
  retentionFloor: EvaluationRetentionFloor;
  execution: EvaluationExecution;
  inputResolution: EvaluationInputsResolution;
  environment: EvaluationInstallEnvironment;
  customEvaluators: EvaluationCustomEvaluators;
  rescore: EvaluationRescore;
  warmup: EvaluationWarmupProbe;
  analytics: EvaluationRunAnalytics;
  report: EvaluationReport;
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
export function createUnavailableEvaluationInfrastructure(
  processName: string,
): EvaluationInfrastructure {
  const unavailable = (capability: string): never => {
    throw new Error(`${processName} composes no ${capability}`);
  };

  return {
    retentionFloor: { getFloorMs: async () => 0 },
    execution: { execute: async () => unavailable("evaluation executor") },
    inputResolution: { tryResolve: async (input) => input.inputs },
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
  MembersRead<typeof EvaluationApp.reads>,
  undefined,
  EvaluationRepositories
>;

/**
 * This process composes no evaluator runtime of its own: the module answers
 * every capability by name rather than reading a bespoke member.
 */
const EVALUATION_PROCESS_NAME = "the evaluation module";

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
    /** Owns the platform default retention the run reads are floored at, read per lookup. */
    retention: DataRetentionApi,
  };
  static readonly reads = reads();

  readonly #service: EvaluationService;
  readonly #modelProviders: ModelProviderApi;
  readonly #environment: EvaluationInstallEnvironment;
  readonly #customEvaluators: EvaluationCustomEvaluators;
  readonly #rescore: EvaluationRescore;
  readonly #warmup: EvaluationWarmupProbe;
  readonly #analytics: EvaluationRunAnalytics;
  readonly #report: EvaluationReport;
  readonly #batchLog: EvaluationBatchLogService;
  readonly #autoslug: EvaluationNameAutoslugService;
  readonly #experiments: EvaluationExperimentDirectory;
  readonly #slugs: EvaluationSlugDirectory;
  readonly #savedEvaluators: EvaluationSavedEvaluatorDirectory;
  readonly #models: EvaluationModelCascade;
  readonly #ledger: EvaluationLedger;
  readonly #runner: EvaluationRunner;
  readonly #commands: EvaluationCommandDispatcherService | undefined;

  private constructor({
    service,
    dependencies,
    members,
    commands,
  }: {
    service: EvaluationService;
    dependencies: EvaluationSetup["dependencies"];
    members: EvaluationInfrastructure;
    commands: EvaluationCommandDispatcherService | undefined;
  }) {
    this.#service = service;
    this.#modelProviders = dependencies.modelProviders;
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
    this.#commands = commands;
    this.#autoslug = EvaluationNameAutoslugService.create();
    this.#batchLog = EvaluationBatchLogService.create({
      experiments: members.experiments,
      runs: members.experimentRuns,
      report: members.report,
    });
  }

  /**
   * Run history, the monitor trend, the retention floor and the report
   * command are real; the rest is still the closed stub until its port lands
   * (`.claude/handoffs/port-evaluation-runtime.md`).
   */
  static create({ dependencies, repositories }: EvaluationSetup): EvaluationApp {
    const commands = EvaluationCommandDispatcherService.create();

    return EvaluationApp.fromInfrastructure({
      infrastructure: {
        ...createUnavailableEvaluationInfrastructure(EVALUATION_PROCESS_NAME),
        retentionFloor: EvaluationRetentionFloorService.create(dependencies.retention),
        report: commands,
      },
      dependencies,
      repositories,
      commands,
    });
  }

  static fromInfrastructure(setup: {
    infrastructure: EvaluationInfrastructure;
    dependencies: EvaluationSetup["dependencies"];
    repositories: Pick<EvaluationRepositories, "runs" | "monitorPerformance">;
    commands?: EvaluationCommandDispatcherService;
  }): EvaluationApp {
    const { infrastructure: members, dependencies, repositories, commands } = setup;

    return new EvaluationApp({
      service: EvaluationService.create({
        repository: repositories.runs,
        monitorPerformance: repositories.monitorPerformance,
        retentionFloor: members.retentionFloor,
        execution: members.execution,
        inputResolution: members.inputResolution,
        workflows: dependencies.workflows,
      }),
      dependencies,
      members,
      commands,
    });
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
