/**
 * The experiment feature's application: what both of its doors call.
 */
import { AgentApi } from "@langwatch/agent-contract";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { DatasetApi, type Dataset } from "@langwatch/dataset-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { EventingCommands } from "@langwatch/eventing";
import {
  ExperimentApi,
  type ExperimentCaller,
  type ExperimentRunLookupInput,
  type ExperimentUpdateFrame,
  type ExperimentWithRuns,
  type ExperimentWorkflowCopyInput,
  type ExperimentWorkflowVersionInput,
  type CommitWorkbenchVersionInput,
  type CompleteExperimentRunInput,
  type ComputeExperimentRunMetricsCommandData,
  type ExperimentIdLookupResult,
  type CreateEvaluationsV3Input,
  type DSPyRunsSummary,
  type Experiment,
  type ExperimentDspyStep,
  type ExperimentDspyStepLookup,
  type ExperimentDspyStepSummary,
  type ExperimentDspyStepsLookup,
  type ExperimentLookup,
  type ExperimentPage,
  type ExperimentPageInput,
  type ExperimentPublishedMonitor,
  type ExperimentRun,
  type ExperimentRunAggregate,
  type ExperimentRunListInput,
  type ExperimentRunLookup,
  type ExperimentRunPageInput,
  type ExperimentRunSlugPageInput,
  type ExperimentRunWithItems,
  type RunResultsRequest,
  type RunStatusAnswer,
  type RunsPageAnswer,
  type RunsPageRequest,
  type SavedRunAnswer,
  type SavedWorkbenchRead,
  type SavedRunRequest,
  type WorkbenchRunAnswer,
  type ExperimentSlugLookup,
  type ExperimentType,
  type FindOrCreateWorkflowExperimentInput,
  type GetWorkbenchStateInput,
  type ListWorkbenchVersionsInput,
  type RecordEvaluatorResultInput,
  type RecordTargetResultInput,
  type RecordWorkbenchRunResultsInput,
  type RestoreWorkbenchVersionInput,
  type SaveExperimentInput,
  type SaveWorkbenchStateInput,
  type StartExperimentRunInput,
  type WorkbenchActor,
  type WorkbenchSaveResult,
  type WorkbenchStateView,
  type WorkbenchStateAnswer,
  type WorkbenchStateBySlugRequest,
  type WorkbenchSavedVersion,
  type WorkbenchVersionsAnswer,
  type WorkbenchVersionsBySlugRequest,
  type SaveWorkbenchStateBySlugRequest,
  type WorkbenchVersionsPage,
  type ExperimentUsageCount,
  type ExperimentCopied,
  type ExperimentCopyInput,
  experimentConfig,
  type ExperimentServerConfig,
  type ExperimentEvaluationsListInput,
  type ExperimentEvaluationsListPage,
  type ExperimentIdOrSlugInput,
  type ExperimentWizardSaveInput,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import { generate } from "@langwatch/ksuid";
import { ModelProviderApi, type ModelCostRate } from "@langwatch/model-provider-contract";
import { MonitorApi } from "@langwatch/monitor-contract";
import { PresenceApi } from "@langwatch/presence-contract";
import type { FeatureSetup } from "@langwatch/process";
import { type MembersRead } from "@langwatch/process-stores/members";
import { ProjectApi } from "@langwatch/project-contract";
import { PromptApi } from "@langwatch/prompt-contract";
import { StoredObjectApi } from "@langwatch/stored-object-contract";
import { SuiteApi } from "@langwatch/suite-contract";
import {
  WorkflowApi,
  type StudioWorkflow,
  type WorkflowEvaluationRequest,
  type WorkflowEvaluationStarted,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";

import {
  buildExperimentLifecyclePipeline,
  type ExperimentLifecyclePipeline,
} from "../eventing/experiment-lifecycle.pipeline.ts";
import type { ExperimentRunProcessingPipeline } from "../eventing/experiment-run-processing.pipeline.ts";
import { ClickHouseExperimentDspyRepository } from "../repositories/clickhouse/clickhouse.experiment-dspy.repository.ts";
import { ClickHouseExperimentRunRepository } from "../repositories/clickhouse/clickhouse.experiment-run.repository.ts";
import { ClickHouseExperimentSession } from "../repositories/clickhouse/clickhouse.experiment-session.store.ts";
import { PrismaExperimentPeopleRepository } from "../repositories/prisma/prisma.experiment-people.repository.ts";
import { PrismaExperimentWorkflowVersionRepository } from "../repositories/prisma/prisma.experiment-workflow-version.repository.ts";
import { PrismaExperimentRepository } from "../repositories/prisma/prisma.experiment.repository.ts";
import { createBlankWorkbenchState } from "../rules/experiment-blank-workbench-state.rules.ts";
import {
  EXPERIMENT_DISAMBIGUATOR_KSUID_RESOURCE,
  slugifyExperimentName,
} from "../rules/experiment-slug.rules.ts";
import { workbenchActorFrom } from "../rules/experiment-workbench-actor.rules.ts";
import { ExperimentCopyService } from "../services/experiment-copy.service.ts";
import { ExperimentDspyRetentionService } from "../services/experiment-dspy-retention.service.ts";
import { ExperimentFindOrCreateService } from "../services/experiment-find-or-create.service.ts";
import { ExperimentListingService } from "../services/experiment-listing.service.ts";
import { ExperimentRunCommandDispatcherService } from "../services/experiment-run-command-dispatcher.service.ts";
import { ExperimentRunHistoryTelemetryService } from "../services/experiment-run-history-telemetry.service.ts";
import type { ExperimentRunModelCostService } from "../services/experiment-run-model-cost.service.ts";
import {
  ExperimentRunService,
  type ExperimentRunProcessing,
} from "../services/experiment-run.service.ts";
import { ExperimentTargetEntityNamesService } from "../services/experiment-target-entity-names.service.ts";
import {
  ExperimentUpdateStreamService,
  type ExperimentUpdateEmitters,
} from "../services/experiment-update-stream.service.ts";
import {
  ExperimentWorkbenchObserverService,
  type ExperimentWorkbenchObserver,
} from "../services/experiment-workbench-observer.service.ts";
import { ExperimentWorkbenchPresenceUpdatesService } from "../services/experiment-workbench-presence-updates.service.ts";
import {
  ExperimentWorkbenchRunService,
  type WorkbenchExecutionRequest,
} from "../services/experiment-workbench-run.service.ts";
import { ExperimentWorkbenchTargetNamesService } from "../services/experiment-workbench-target-names.service.ts";
import { ExperimentWorkbenchVersionService } from "../services/experiment-workbench-version.service.ts";
import { ExperimentWorkflowAuthoringService } from "../services/experiment-workflow-authoring.service.ts";
import type { WorkflowEvaluationService } from "../services/experiment-workflow-evaluation.service.ts";
import { ExperimentWorkflowLinkService } from "../services/experiment-workflow-link.service.ts";
import { ExperimentService } from "../services/experiment.service.ts";

/** The display names behind the author ids a version history stores. */
export type ExperimentPeople = Readonly<{
  namesOf(
    ids: readonly string[],
  ): Promise<readonly Readonly<{ id: string; name: string | null }>[]>;
}>;

/** What the process composes this feature's application from. */
export interface ExperimentAppDependencies {
  experiments: ExperimentService;
  /** The ONE find-or-create rule this deployment resolves an SDK slug through. */
  runLookup: ExperimentFindOrCreateService;
  workflows: WorkflowApi;
  workflowAuthoring: Pick<
    ExperimentWorkflowAuthoringService,
    "create" | "saveVersion" | "copyWithDatasets"
  >;
  dataset: DatasetApi;
  monitors: Pick<MonitorApi, "deleteForExperiment" | "upsertForExperiment">;
  /** Presence's tenant fan-out, where `experiment_updated` arrives. */
  broadcast: ExperimentUpdateEmitters;
  permissions: Pick<AuthzApi, "hasPermission">;
  people: ExperimentPeople;
  /** The project's own model cost rules, as the pricing cascade reads them. */
  modelCosts: Pick<ExperimentRunModelCostService, "listFor">;
  /** The slug this deployment derives from a name. */
  slugify(value: string): string;
  /** Resolves a saved workbench's column names, over the prompts, agents and evaluators. */
  workbenchTargetNames(input: {
    projectId: string;
    targets: TargetConfig[];
  }): Promise<Record<string, string>>;
  /** Where a run is recorded and an unnamed failure reported. Both best-effort. */
  workbenchObserver: ExperimentWorkbenchObserver;
  /** Starts a workflow's evaluation here and runs it where the pipeline is drained. */
  workflowEvaluations: WorkflowEvaluationService;
  /** `experiment_lifecycle`, which peers react to; absent where a suite builds none. */
  lifecycle?: Readonly<{
    pipeline: ExperimentLifecyclePipeline;
    senders: { commands?: EventingCommands<ExperimentLifecyclePipeline> };
  }>;
  /** The run pipeline, its senders and run lookup; absent where a suite builds none. */
  runProcessing?: ExperimentRunProcessing;
}

/** An experiment nobody has run yet. Defaulted here so no door decides it. */
const NO_RUNS: ExperimentRunAggregate = { runsCount: 0, lastRunAt: null };

type ExperimentSetup = FeatureSetup<
  typeof ExperimentModule.dependencies,
  MembersRead<readonly ["prisma", "clickhouse", "redis", "logger"]> &
    Readonly<{ publicBaseUrl: string | undefined; processName: string; isSaas: boolean }>,
  ExperimentServerConfig
>;

export class ExperimentModule implements ExperimentApi {
  static readonly contract = ExperimentApi;
  static readonly dependencies = {
    workflows: WorkflowApi,
    dataset: DatasetApi,
    monitors: MonitorApi,
    agents: AgentApi,
    evaluators: EvaluatorApi,
    prompts: PromptApi,
    permissions: AuthzApi,
    /** The one publisher of the live-update wire; a workbench save's notice rides it. */
    presence: PresenceApi,
    /** The directory that answers which organization a project belongs to. */
    projects: ProjectApi,
    /** The tier-effective row bound an execution's dataset must fit under. */
    entitlement: EntitlementApi,
    /** Owns the platform default retention a run's rows are stamped with, read lazily. */
    retention: DataRetentionApi,
    /** Owns the project's custom model cost rules the optimizer log prices against. */
    modelProviders: ModelProviderApi,
    /** Where a run's evaluator results are reported as evaluations. */
    evaluation: EvaluationApi,
    /** Mints the sandbox key a run lends the code it executes. */
    apiKeys: ApiKeyApi,
    /** Owns the rule refusing a run against someone else's personal agent. */
    suite: SuiteApi,
    /** Reads a row's stored attachment for the target it is dispatched to. */
    storedObjects: StoredObjectApi,
  };
  static readonly config = experimentConfig;
  static readonly reads = [
    "prisma",
    "clickhouse",
    "redis",
    "logger",
    "publicBaseUrl",
    "processName",
    "isSaas",
  ] as const;

  static create(setup: ExperimentSetup): ExperimentModule {
    const { members, dependencies, config } = setup;
    const { prisma, clickhouse, logger } = members;
    const { workflows, dataset, agents, evaluators, prompts, retention } = dependencies;
    const commands = ExperimentRunCommandDispatcherService.create();
    const senders: { commands?: EventingCommands<ExperimentLifecyclePipeline> } = {};
    const resolveClient = ClickHouseExperimentSession.resolverOver(clickhouse);
    const telemetry = ExperimentRunHistoryTelemetryService.create(logger);
    const experiments = ExperimentService.create({
      repository: PrismaExperimentRepository.create(prisma),
      runRepository: ClickHouseExperimentRunRepository.create({
        workflowVersions: PrismaExperimentWorkflowVersionRepository.create(prisma),
        resolveClient,
        tupleParam: (values) => ClickHouseExperimentRunRepository.tupleParam(values),
        telemetry,
      }),
      dspyRepository: ClickHouseExperimentDspyRepository.create({
        resolveClient,
        retention: ExperimentDspyRetentionService.create({ retention }),
        telemetry,
      }),
      execution: commands,
      slugify: slugifyExperimentName,
      newId: () => generate(EXPERIMENT_DISAMBIGUATOR_KSUID_RESOURCE).toString(),
      references: { prompts, agents, evaluators, workflows, dataset },
      updates: ExperimentWorkbenchPresenceUpdatesService.create({
        presence: dependencies.presence,
        logger,
      }),
    });
    const runs = ExperimentRunService.create({
      commands,
      experiments,
      resolveClient,
      members,
      peers: dependencies,
      config,
    });
    const targetNames = ExperimentWorkbenchTargetNamesService.create();
    const entities = ExperimentTargetEntityNamesService.create({ agents, evaluators });

    return new ExperimentModule({
      experiments,
      runLookup: ExperimentFindOrCreateService.create(experiments),
      slugify: slugifyExperimentName,
      workbenchTargetNames: (input) => targetNames.resolve({ ...input, prompts, entities }),
      workflows,
      dataset,
      monitors: dependencies.monitors,
      broadcast: dependencies.presence,
      permissions: dependencies.permissions,
      people: PrismaExperimentPeopleRepository.create(prisma),
      modelCosts: runs.cost,
      workflowAuthoring: ExperimentWorkflowAuthoringService.create(workflows),
      workflowEvaluations: runs.workflowEvaluations,
      workbenchObserver: ExperimentWorkbenchObserverService.create({ logger, senders }),
      lifecycle: { pipeline: buildExperimentLifecyclePipeline(), senders },
      runProcessing: runs.processing,
    });
  }

  /**
   * Every member named directly, for a suite that composes its own fakes
   * rather than driving the reads/dependencies this App builds them from —
   * the process root never calls this, since a real one is always booted.
   */
  static createForTesting(dependencies: ExperimentAppDependencies): ExperimentModule {
    return new ExperimentModule(dependencies);
  }

  #dependencies: ExperimentAppDependencies;
  #workbenchRuns: ExperimentWorkbenchRunService;
  #workbenchVersions: ExperimentWorkbenchVersionService;
  #workflowLinks: ExperimentWorkflowLinkService;
  #copies: ExperimentCopyService;
  #listing: ExperimentListingService;

  private constructor(dependencies: ExperimentAppDependencies) {
    this.#dependencies = dependencies;
    this.#workbenchRuns = ExperimentWorkbenchRunService.create({
      experiments: dependencies.experiments,
      observer: dependencies.workbenchObserver,
      ...(dependencies.runProcessing ? { runs: dependencies.runProcessing } : {}),
    });
    this.#workbenchVersions = ExperimentWorkbenchVersionService.create({
      experiments: dependencies.experiments,
      workbenchTargetNames: (input) => dependencies.workbenchTargetNames(input),
    });
    this.#workflowLinks = ExperimentWorkflowLinkService.create({
      experiments: dependencies.experiments,
      workflows: dependencies.workflows,
      workflowAuthoring: dependencies.workflowAuthoring,
      dataset: dependencies.dataset,
      monitors: dependencies.monitors,
      slugify: (value) => dependencies.slugify(value),
    });
    this.#copies = ExperimentCopyService.create({
      experiments: dependencies.experiments,
      links: this.#workflowLinks,
      workflowAuthoring: dependencies.workflowAuthoring,
      dataset: dependencies.dataset,
      permissions: dependencies.permissions,
      slugify: (value) => dependencies.slugify(value),
    });
    this.#listing = ExperimentListingService.create({
      experiments: dependencies.experiments,
      links: this.#workflowLinks,
      dataset: dependencies.dataset,
    });
  }

  /**
   * The service itself, for the process functions that still take it whole.
   */
  get experimentService(): ExperimentService {
    return this.#dependencies.experiments;
  }

  // ── Experiments ────────────────────────────────────────────────

  /** Every active experiment in the project. */
  countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<ExperimentUsageCount> {
    return this.#dependencies.experiments.countUsage(input);
  }

  list(input: Readonly<{ projectId: string }>): Promise<Experiment[]> {
    return this.#dependencies.experiments.list(input);
  }

  /** One page of the project's experiments. */
  getPage(input: ExperimentPageInput): Promise<ExperimentPage> {
    return this.#dependencies.experiments.getPage(input);
  }

  /** One experiment by id. */
  getById(input: ExperimentLookup): Promise<Experiment> {
    return this.#dependencies.experiments.getById(input);
  }

  /** One experiment by id, or null when it is archived or absent. */
  findById(input: ExperimentLookup): Promise<Experiment | null> {
    return this.#dependencies.experiments.findById(input);
  }

  /** One experiment by slug. */
  getBySlug(input: ExperimentSlugLookup): Promise<Experiment> {
    return this.#dependencies.experiments.getBySlug(input);
  }

  /**
   * One experiment by slug, or null when the project has none by that name.
   */
  findBySlug(input: ExperimentSlugLookup): Promise<Experiment | null> {
    return this.#dependencies.experiments.findBySlug(input);
  }

  /**
   * One experiment by slug, only when it is of the kind the caller expects.
   */
  findBySlugAndType(
    input: ExperimentSlugLookup & Readonly<{ type: ExperimentType }>,
  ): Promise<Experiment | null> {
    return this.#dependencies.experiments.findBySlugAndType(input);
  }

  /** One experiment's id and slug, for a caller that holds only the slug. */
  findIdBySlug(input: ExperimentSlugLookup): Promise<{ id: string; slug: string } | null> {
    return this.#dependencies.experiments.findIdBySlug(input);
  }

  /**
   * Whether the experiment is still live — present and not archived.
   */
  isActive(input: ExperimentLookup): Promise<boolean> {
    return this.#dependencies.experiments.isActive(input);
  }

  /** One experiment by whichever identifier the caller holds. */
  getBySlugOrId(input: Readonly<{ projectId: string; slugOrId: string }>): Promise<Experiment> {
    return this.#dependencies.experiments.getBySlugOrId(input);
  }

  /** The project's most recent experiment, or null when it has none. */
  findLatest(input: Readonly<{ projectId: string }>): Promise<Experiment | null> {
    return this.#dependencies.experiments.findLatest(input);
  }

  /** The experiment an SDK's own identifier names, created if it is free. */
  findOrCreateForRun(input: ExperimentRunLookupInput): Promise<Experiment> {
    return this.#dependencies.runLookup.resolve(input);
  }

  /** The name the next unnamed experiment in the project gets. */
  findNextDraftName(input: Readonly<{ projectId: string }>): Promise<string> {
    return this.#dependencies.experiments.findNextDraftName(input);
  }

  /** Creates or replaces an experiment. */
  save(input: SaveExperimentInput): Promise<Experiment> {
    return this.#dependencies.experiments.save(input);
  }

  /** Finds the experiment a workflow already saved evaluations into, or starts one. */
  findOrCreateForWorkflow(
    input: FindOrCreateWorkflowExperimentInput,
  ): Promise<{ id: string; slug: string }> {
    return this.#dependencies.experiments.findOrCreateForWorkflow(input);
  }

  /**
   * Archives an experiment, and with it the workflow it wrote versions into and
   * the monitor it was published as.
   */
  async archive(input: ExperimentLookup): Promise<{ success: true }> {
    const experiment = await this.#dependencies.experiments.findById(input);
    const result = await this.#dependencies.experiments.archive(input);

    if (experiment?.workflowId) {
      await this.#dependencies.workflows.archive({
        id: experiment.workflowId,
        projectId: input.projectId,
      });
    }
    if (experiment) {
      await this.#dependencies.monitors.deleteForExperiment({
        projectId: input.projectId,
        experimentId: input.id,
      });
    }

    return result;
  }

  // ── Runs ───────────────────────────────────────────────────────

  /** The runs of each named experiment, keyed by experiment id. */
  listRuns(input: ExperimentRunListInput): Promise<Record<string, ExperimentRun[]>> {
    return this.#dependencies.experiments.listRuns(input);
  }

  /** One run of one experiment. A missing run reads as null. */
  findRun(input: ExperimentRunLookup): Promise<ExperimentRunWithItems | null> {
    return this.#dependencies.experiments.findRun(input);
  }

  /** The runs of each named experiment, keyed by experiment id, with their aggregate. */
  getRunAggregates(input: ExperimentRunListInput): Promise<Record<string, ExperimentRunAggregate>> {
    return this.#dependencies.experiments.getRunAggregates(input);
  }

  /** One page of an experiment's runs, addressed by id. */
  getRunsPage(
    input: ExperimentRunPageInput,
  ): Promise<{ runs: ExperimentRun[]; totalHits: number }> {
    return this.#dependencies.experiments.getRunsPage(input);
  }

  /**
   * One page of an experiment's runs, addressed by slug.
   */
  getRunsPageBySlug(input: ExperimentRunSlugPageInput): Promise<{
    experiment: { id: string; slug: string };
    runs: ExperimentRun[];
    totalHits: number;
  }> {
    return this.#dependencies.experiments.getRunsPageBySlug(input);
  }

  /**
   * The named experiments with their run count and latest run beside them.
   */
  async withRunAggregates(
    input: Readonly<{ projectId: string; experiments: readonly Experiment[] }>,
  ): Promise<ExperimentWithRuns[]> {
    if (input.experiments.length === 0) return [];

    const aggregates = await this.#dependencies.experiments.getRunAggregates({
      projectId: input.projectId,
      experimentIds: input.experiments.map((experiment) => experiment.id),
    });

    return input.experiments.map((experiment) => {
      const aggregate = aggregates[experiment.id] ?? NO_RUNS;
      return {
        experiment,
        runsCount: aggregate.runsCount,
        lastRunAt: aggregate.lastRunAt,
      };
    });
  }

  // ── Run execution ────────────────────────────────────────────── What an
  // execution reports as it goes. These take no caller: a run is already
  // attributed by the run row the orchestrator opened, and the writes land
  // against that run rather than against whoever is watching it. The
  // orchestrator drives all four from a background job that has no session.

  /** Opens a run: the row every later result is written against. */
  startExperimentRun(input: StartExperimentRunInput): Promise<void> {
    return this.#dependencies.experiments.startExperimentRun(input);
  }

  /** One target's output for one dataset row. */
  recordTargetResult(input: RecordTargetResultInput): Promise<void> {
    return this.#dependencies.experiments.recordTargetResult(input);
  }

  /** One evaluator's verdict on one target's output. */
  recordEvaluatorResult(input: RecordEvaluatorResultInput): Promise<void> {
    return this.#dependencies.experiments.recordEvaluatorResult(input);
  }

  /** Closes a run, whether it finished or was stopped. */
  completeExperimentRun(input: CompleteExperimentRunInput): Promise<void> {
    return this.#dependencies.experiments.completeExperimentRun(input);
  }

  /** One trace's cost, folded into its run by the run pipeline. */
  computeRunMetrics(input: ComputeExperimentRunMetricsCommandData): Promise<void> {
    return this.#runProcessing().commands.computeRunMetrics(input);
  }

  /** The experiment a run was recorded against, or that no experiment recorded it. */
  async lookupExperimentId(input: {
    tenantId: string;
    runId: string;
  }): Promise<ExperimentIdLookupResult> {
    const experimentId = await this.#runProcessing().idLookup.findExperimentId(input);
    return experimentId ? { kind: "recorded", experimentId } : { kind: "not_recorded" };
  }

  /** The pipeline `experiment_run_processing` registers, built once by {@link create}. */
  eventingPipeline(): ExperimentRunProcessingPipeline {
    return this.#runProcessing().pipeline;
  }

  /** Refuses what it can, then sends the evaluation for the worker to run. */
  triggerWorkflowEvaluation(input: WorkflowEvaluationRequest): Promise<WorkflowEvaluationStarted> {
    return this.#dependencies.workflowEvaluations.request(input);
  }

  /** The pipeline `experiment_lifecycle` registers, built once by {@link create}. */
  lifecyclePipeline(): ExperimentLifecyclePipeline {
    if (!this.#dependencies.lifecycle) {
      throw new Error("Experiment was asked for its lifecycle pipeline, but none was built");
    }

    return this.#dependencies.lifecycle.pipeline;
  }

  /** Binds the lifecycle pipeline's own senders. */
  connectLifecycleCommands(commands: EventingCommands<ExperimentLifecyclePipeline>): void {
    if (!this.#dependencies.lifecycle) {
      throw new Error("Experiment was asked to connect its lifecycle pipeline, but none was built");
    }
    this.#dependencies.lifecycle.senders.commands = commands;
  }

  /** Binds the registered pipeline's own senders; every run write goes through them. */
  connectCommands(commands: EventingCommands<ExperimentRunProcessingPipeline>): void {
    this.#runProcessing().commands.connect(commands);
  }

  #runProcessing(): NonNullable<ExperimentAppDependencies["runProcessing"]> {
    if (!this.#dependencies.runProcessing) {
      throw new Error("Experiment was asked for its run pipeline, but none was built");
    }

    return this.#dependencies.runProcessing;
  }

  // ── Optimization runs ──────────────────────────────────────────

  /** The optimization runs recorded against one experiment. */
  listDspyRuns(input: ExperimentDspyStepsLookup): Promise<DSPyRunsSummary[]> {
    return this.#dependencies.experiments.listDspyRuns(input);
  }

  /** One optimization step. */
  getDspyStep(input: ExperimentDspyStepLookup): Promise<ExperimentDspyStep> {
    return this.#dependencies.experiments.getDspyStep(input);
  }

  /** Records one optimization step. */
  upsertDspyStep(input: ExperimentDspyStep): Promise<void> {
    return this.#dependencies.experiments.upsertDspyStep(input);
  }

  /** Every optimization step recorded against one experiment run. */
  listDspySteps(input: ExperimentDspyStepsLookup): Promise<ExperimentDspyStepSummary[]> {
    return this.#dependencies.experiments.listDspySteps(input);
  }

  // ── Workbench ──────────────────────────────────────────────────

  /** The workbench state a page opens on. */
  getWorkbenchState(input: GetWorkbenchStateInput): Promise<WorkbenchStateView> {
    return this.#dependencies.experiments.getWorkbenchState(input);
  }

  /** The version history of one experiment's workbench. */
  listWorkbenchVersions(input: ListWorkbenchVersionsInput): Promise<WorkbenchVersionsPage> {
    return this.#dependencies.experiments.listWorkbenchVersions(input);
  }

  /** Writes the workbench, attributed to the caller who asked for it. */
  saveWorkbenchState(
    input: Omit<SaveWorkbenchStateInput, "actor">,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult> {
    return this.#dependencies.experiments.saveWorkbenchState({
      ...input,
      actor: ExperimentModule.actorFor(by),
    });
  }

  /**
   * Creates an evaluations experiment, attributed to the caller who asked for
   * it.
   */
  createEvaluationsV3(
    input: Omit<CreateEvaluationsV3Input, "actor" | "state"> &
      Readonly<{ state?: CreateEvaluationsV3Input["state"] }>,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult> {
    const { state, ...rest } = input;
    return this.#dependencies.experiments.createEvaluationsV3({
      ...rest,
      state: state ?? createBlankWorkbenchState(rest.name ? { name: rest.name } : {}),
      actor: ExperimentModule.actorFor(by),
    });
  }

  /** Names the current workbench a version, attributed to its caller. */
  commitWorkbenchVersion(
    input: Omit<CommitWorkbenchVersionInput, "actor">,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult> {
    return this.#dependencies.experiments.commitWorkbenchVersion({
      ...input,
      actor: ExperimentModule.actorFor(by),
    });
  }

  /** Puts a past version back, attributed to the caller who asked for it. */
  restoreWorkbenchVersion(
    input: Omit<RestoreWorkbenchVersionInput, "actor">,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult> {
    return this.#dependencies.experiments.restoreWorkbenchVersion({
      ...input,
      actor: ExperimentModule.actorFor(by),
    });
  }

  /** Puts a past version back by the slug and path segment a REST door names. */
  restoreWorkbenchVersionBySlug(
    input: Readonly<{ projectId: string; slug: string; version: number }>,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult> {
    return this.#workbenchVersions.restoreBySlug({
      ...input,
      actor: ExperimentModule.actorFor(by),
    });
  }

  /** `GET /:slug/workbench-state`'s answer, `fields=version` leaving out the setup. */
  readWorkbenchStateBySlug(input: WorkbenchStateBySlugRequest): Promise<WorkbenchStateAnswer> {
    return this.#workbenchVersions.readStateBySlug(input);
  }

  /** `PUT /:slug/workbench-state`: saves the setup as its caller and answers the version. */
  saveWorkbenchStateBySlug(
    input: SaveWorkbenchStateBySlugRequest,
    by: ExperimentCaller,
  ): Promise<WorkbenchSavedVersion> {
    return this.#workbenchVersions.saveBySlug({ ...input, actor: ExperimentModule.actorFor(by) });
  }

  /** `GET /:slug/versions`: one page of the history, as the REST door publishes it. */
  listWorkbenchVersionsBySlug(
    input: WorkbenchVersionsBySlugRequest,
  ): Promise<WorkbenchVersionsAnswer> {
    return this.#workbenchVersions.listBySlug(input);
  }

  /** Records a run's cell results directly against the workbench state. */
  recordWorkbenchRunResults(input: RecordWorkbenchRunResultsInput): Promise<WorkbenchSaveResult> {
    return this.#dependencies.experiments.recordWorkbenchRunResults(input);
  }

  // ── Workflows ──────────────────────────────────────────────────

  /**
   * The workflow behind an experiment, or null when it is gone. Also what the
   * wizard save and the copy ask to know an id still resolves in a project.
   */
  findWorkflow(
    input: Readonly<{ id: string; projectId: string; includeVersion?: boolean }>,
  ): Promise<WorkflowWithVersion | null> {
    return this.#workflowLinks.findWorkflow(input);
  }

  // ── The legacy wizard and the evaluations list ─────────────────

  /** One experiment by its id when given, else by its slug; neither is a 400. */
  getByIdOrSlug(input: ExperimentIdOrSlugInput): Promise<Experiment> {
    return this.#listing.getByIdOrSlug(input);
  }

  /** Saves the wizard's setup, writing a version of its graph into the experiment's workflow. */
  saveWithWorkflow(
    input: ExperimentWizardSaveInput,
    by: Readonly<{ id: string }>,
  ): Promise<Experiment> {
    return this.#workflowLinks.saveWithWorkflow(input, by);
  }

  /** Publishes a wizard experiment's evaluator as a monitor, refusing one not ready to be. */
  saveAsMonitor(
    input: Readonly<{ projectId: string; experimentId: string }>,
  ): Promise<ExperimentPublishedMonitor> {
    return this.#workflowLinks.saveAsMonitor(input);
  }

  /** One page of the evaluations list, legacy online evaluations excluded, newest run first. */
  listForEvaluations(
    input: ExperimentEvaluationsListInput,
  ): Promise<ExperimentEvaluationsListPage> {
    return this.#listing.listForEvaluations(input);
  }

  /** Copies an experiment from a source project the caller may also manage evaluations in. */
  copyToProject(
    input: ExperimentCopyInput,
    by: Readonly<{ id: string }>,
  ): Promise<ExperimentCopied> {
    return this.#copies.copyToProject(input, by);
  }

  // ── Datasets ───────────────────────────────────────────────────

  /** The named datasets of one project. */
  getDatasets(input: Readonly<{ projectId: string; datasetIds: string[] }>): Promise<Dataset[]> {
    return this.#dependencies.dataset.getByIds(input);
  }

  /** Renames one dataset, so a renamed experiment's datasets follow it. */
  renameDataset(
    input: Readonly<{ datasetId: string; projectId: string; name: string }>,
  ): Promise<Dataset> {
    return this.#dependencies.dataset.renameDataset(input);
  }

  /** Copies a dataset into another project. */
  copyDataset(
    input: Readonly<{
      sourceDatasetId: string;
      sourceProjectId: string;
      targetProjectId: string;
    }>,
  ): Promise<Dataset> {
    return this.#dependencies.dataset.copyDataset(input);
  }

  // ── Broadcast ──────────────────────────────────────────────────

  /**
   * The freshness signals a workbench save lands on, for as long as the caller
   * listens. Subscribing and releasing are paired here so no door can hold the
   * fan-out open past the tab that asked for it.
   */
  async *watchUpdates(
    input: Readonly<{ projectId: string; signal?: AbortSignal | undefined }>,
  ): AsyncIterable<ExperimentUpdateFrame> {
    yield* ExperimentUpdateStreamService.create({
      emitters: this.#dependencies.broadcast,
    }).watch(input);
  }

  // ── Studio writes ──────────────────────────────────────────────

  /** Creates the workflow a new wizard experiment writes into, its first graph as version one. */
  createWorkflow(
    input: Readonly<{
      projectId: string;
      dsl: StudioWorkflow;
      commitMessage: string;
      autoSaved: boolean;
    }>,
    by: Readonly<{ id: string }>,
  ): Promise<Readonly<{ id: string }>> {
    return this.#dependencies.workflowAuthoring.create(input, by);
  }

  /** Writes a workflow version, autosaved or committed. */
  saveWorkflowVersion(
    input: ExperimentWorkflowVersionInput,
    by: Readonly<{ id: string }>,
  ): Promise<void> {
    return this.#dependencies.workflowAuthoring.saveVersion(input, by);
  }

  /** Copies a workflow, and optionally its datasets, into another project. */
  copyWorkflowWithDatasets(
    input: ExperimentWorkflowCopyInput,
  ): Promise<Readonly<{ workflowId: string; dsl: StudioWorkflow }>> {
    return this.#dependencies.workflowAuthoring.copyWithDatasets(input);
  }

  // ── Monitors ───────────────────────────────────────────────────

  /** Creates or replaces the monitor an experiment is published as. */
  async publishAsMonitor(
    input: Readonly<{
      projectId: string;
      experimentId: string;
      monitor: Readonly<{
        name: string;
        checkType: string;
        slug: string;
        preconditions: unknown;
        parameters: Record<string, unknown>;
        mappings: unknown;
        sample: number;
        enabled: boolean;
        executionMode: string;
      }>;
    }>,
  ): Promise<ExperimentPublishedMonitor> {
    return this.#dependencies.monitors.upsertForExperiment({
      projectId: input.projectId,
      experimentId: input.experimentId,
      ...input.monitor,
    });
  }

  // ── The caller and the deployment ──────────────────────────────

  /** The slug this deployment derives from a name. */
  slugFor(value: string): string {
    return this.#dependencies.slugify(value);
  }

  /**
   * Whether the caller may manage evaluations in a project the declared check
   * never covered.
   */
  mayManageEvaluations(input: Readonly<{ actorId: string; projectId: string }>): Promise<boolean> {
    return this.#dependencies.permissions.hasPermission({
      userId: input.actorId,
      permission: "evaluations:manage",
      projectId: input.projectId,
    });
  }

  /** The project's own model cost rules, for the optimizer log's pricing. */
  listModelCosts(input: Readonly<{ projectId: string }>): Promise<readonly ModelCostRate[]> {
    return this.#dependencies.modelCosts.listFor(input);
  }

  /** The display names behind the author ids on a version history. */
  resolveAuthorNames(
    authorIds: readonly string[],
  ): Promise<readonly Readonly<{ id: string; name: string | null }>[]> {
    if (authorIds.length === 0) return Promise.resolve([]);

    return this.#dependencies.people.namesOf(authorIds);
  }

  // ── The workbench's own doors ────────────────────────

  abortWorkbenchRun(
    input: Readonly<{
      projectId: string;
      runId: string;
    }>,
    by: Readonly<{ id: string }>,
  ): Promise<{ success: true; runId: string; message: "Abort requested" }> {
    return this.#workbenchRuns.abortRun(input, by);
  }

  resolveWorkbenchTargetNames(input: {
    projectId: string;
    targets: TargetConfig[];
  }): Promise<Record<string, string>> {
    return this.#dependencies.workbenchTargetNames(input);
  }

  startSavedRun(input: SavedRunRequest): Promise<SavedRunAnswer> {
    return this.#workbenchRuns.startSavedRun(input);
  }

  projectSavedWorkbench(input: {
    projectId: string;
    slug: string;
    includeResults?: boolean;
  }): Promise<SavedWorkbenchRead> {
    return this.#workbenchVersions.projectSavedBySlug(input);
  }

  executeWorkbenchRun(
    input: WorkbenchExecutionRequest,
    by: Readonly<{ id: string }>,
  ): Promise<WorkbenchRunAnswer> {
    return this.#workbenchRuns.executeWorkbenchRun(input, by);
  }

  listRunsPage(input: RunsPageRequest): Promise<RunsPageAnswer> {
    return this.#workbenchRuns.listRunsPage(input);
  }

  pollRun(input: Readonly<{ projectId: string; runId: string }>): Promise<RunStatusAnswer> {
    return this.#workbenchRuns.pollRun(input);
  }

  readRunResults(input: RunResultsRequest): Promise<ExperimentRunWithItems> {
    return this.#workbenchRuns.readRunResults(input);
  }

  /**
   * The application the workbench's four setup doors answer from. Held whole
   * rather than called through the module's reference, because several of
   * those doors read the service the reference only publishes operations on.
   */
  experiments(): ExperimentModule {
    return this;
  }

  /** Records that a person ran an experiment. Best-effort. */
  recordExperimentRan(
    input: Readonly<{
      userId: string;
      projectId: string;
      experimentId: string | undefined;
      isFullRun: boolean;
    }>,
  ): void {
    this.#dependencies.workbenchObserver.recordExperimentRan(input);
  }

  /** Where an unnamed workbench failure is reported. Best-effort. */
  reportError(error: unknown, context: Readonly<Record<string, unknown>>): void {
    this.#dependencies.workbenchObserver.reportError(error, context);
  }

  /**
   * The stored attribution for one caller.
   */
  private static actorFor(by: ExperimentCaller): WorkbenchActor {
    if (by.kind === "user") return { userId: by.id, label: "user" };
    return workbenchActorFrom({ credential: by.credential });
  }
}
