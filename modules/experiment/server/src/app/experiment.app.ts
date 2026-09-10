/**
 * The experiment feature's application: what both of its doors call.
 */
import type { WorkflowService } from "@langwatch/workflow-server";
import type { Dataset, DatasetApi } from "@langwatch/dataset-contract";
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
  type WorkbenchVersionsPage,
} from "@langwatch/experiment-contract";
import type { ModelCostRate } from "@langwatch/model-provider-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { on } from "node:events";
import type { ExperimentService } from "../services/experiment.service.ts";
import type { ExperimentFindOrCreateService } from "../services/experiment-find-or-create.service.ts";
import { WorkflowNotFoundError, type StudioWorkflow, type WorkflowWithVersion } from "@langwatch/workflow-contract";
import { createBlankWorkbenchState } from "../rules/experiment-blank-workbench-state.rules.ts";
import { workbenchActorFrom } from "../rules/experiment-workbench-actor.rules.ts";

/**
 * The project-scoped signal fan-out an editor tab follows. Declared as the two
 * methods the transports call: the emitter itself is the host's, shared with
 * every other subscription surface.
 */
export type ExperimentBroadcast = Readonly<{
  getTenantEmitter(projectId: string): EventEmitter;
  cleanupTenantEmitter(projectId: string): void;
}>;

/** The two monitor writes an experiment drives: its publication and its archive. */
export type ExperimentMonitorCascade = Readonly<{
  deleteForExperiment(
    input: Readonly<{ projectId: string; experimentId: string }>,
  ): Promise<unknown>;
  /**
   * Creates or replaces the monitor an experiment is published as. `mappings`
   * arrives as the wizard stored it; canonicalising it is the monitor side's,
   * because the mapping vocabulary is the tracer's rather than this feature's.
   */
  upsertForExperiment(
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
  ): Promise<ExperimentPublishedMonitor>;
}>;

/**
 * The studio writes a wizard experiment drives. Separate from the read-only
 * `WorkflowService` because these three CREATE graphs, and a read surface
 * that could create one would be a different promise.
 */
export type ExperimentWorkflowAuthoring = Readonly<{
  create(
    input: Readonly<{
      projectId: string;
      name: string;
      icon?: string | null;
      description?: string | null;
    }>,
  ): Promise<Readonly<{ id: string }>>;
  saveVersion(input: ExperimentWorkflowVersionInput): Promise<void>;
  copyWithDatasets(
    input: ExperimentWorkflowCopyInput,
  ): Promise<Readonly<{ workflowId: string; dsl: StudioWorkflow }>>;
}>;

/** What the doors ask about the caller, beyond the check already declared. */
export type ExperimentPermissions = Readonly<{
  mayManageEvaluations(
    input: Readonly<{ actorId: string; projectId: string }>,
  ): Promise<boolean>;
}>;

/** The project's own model cost rules, as the pricing cascade reads them. */
export type ExperimentModelCosts = Readonly<{
  listFor(input: Readonly<{ projectId: string }>): Promise<readonly ModelCostRate[]>;
}>;

/** The display names behind the author ids a version history stores. */
export type ExperimentPeople = Readonly<{
  namesOf(
    ids: readonly string[],
  ): Promise<ReadonlyArray<Readonly<{ id: string; name: string | null }>>>;
}>;

/** What the process composes this feature's application from. */
export interface ExperimentAppDependencies {
  experiments: ExperimentService;
  /** The ONE find-or-create rule this deployment resolves an SDK slug through. */
  runLookup: ExperimentFindOrCreateService;
  workflows: WorkflowService;
  workflowAuthoring: ExperimentWorkflowAuthoring;
  dataset: DatasetApi;
  monitors: ExperimentMonitorCascade;
  broadcast: ExperimentBroadcast;
  permissions: ExperimentPermissions;
  people: ExperimentPeople;
  /** The project's own model cost rules, as the pricing cascade reads them. */
  modelCosts: ExperimentModelCosts;
  /** The slug this deployment derives from a name. */
  slugify(value: string): string;
}

/** An experiment nobody has run yet. Defaulted here so no door decides it. */
const NO_RUNS: ExperimentRunAggregate = { runsCount: 0, lastRunAt: null };

export class ExperimentApp implements ExperimentApi {
  static readonly contract = ExperimentApi;
  static readonly dependencies = {} as const;

  static create(
    setup: FeatureSetup<Readonly<Record<never, never>>, ExperimentAppDependencies, undefined>,
  ): ExperimentApp {
    return new ExperimentApp(setup.infrastructure);
  }

  #dependencies: ExperimentAppDependencies;

  private constructor(dependencies: ExperimentAppDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * The service itself, for the process functions that still take it whole.
   */
  get experimentService(): ExperimentService {
    return this.#dependencies.experiments;
  }

  // ── Experiments ────────────────────────────────────────────────

  /** Every active experiment in the project. */
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
  getRunAggregates(
    input: ExperimentRunListInput,
  ): Promise<Record<string, ExperimentRunAggregate>> {
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
      actor: ExperimentApp.actorFor(by),
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
      actor: ExperimentApp.actorFor(by),
    });
  }

  /** Names the current workbench a version, attributed to its caller. */
  commitWorkbenchVersion(
    input: Omit<CommitWorkbenchVersionInput, "actor">,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult> {
    return this.#dependencies.experiments.commitWorkbenchVersion({
      ...input,
      actor: ExperimentApp.actorFor(by),
    });
  }

  /** Puts a past version back, attributed to the caller who asked for it. */
  restoreWorkbenchVersion(
    input: Omit<RestoreWorkbenchVersionInput, "actor">,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult> {
    return this.#dependencies.experiments.restoreWorkbenchVersion({
      ...input,
      actor: ExperimentApp.actorFor(by),
    });
  }

  /** Records a run's cell results directly against the workbench state. */
  recordWorkbenchRunResults(
    input: RecordWorkbenchRunResultsInput,
  ): Promise<WorkbenchSaveResult> {
    return this.#dependencies.experiments.recordWorkbenchRunResults(input);
  }

  // ── Workflows ──────────────────────────────────────────────────

  /**
   * The workflow behind an experiment, or null when it is gone. Also what the
   * wizard save and the copy ask to know an id still resolves in a project.
   */
  async findWorkflow(
    input: Readonly<{ id: string; projectId: string; includeVersion?: boolean }>,
  ): Promise<WorkflowWithVersion | null> {
    try {
      return await this.#dependencies.workflows.getById(input);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return null;
      throw error;
    }
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
    const emitter = this.#dependencies.broadcast.getTenantEmitter(input.projectId);
    try {
      for await (const eventArgs of on(emitter, "experiment_updated", {
        ...(input.signal ? { signal: input.signal } : {}),
      })) {
        yield (eventArgs as unknown[])[0] as ExperimentUpdateFrame;
      }
    } finally {
      this.#dependencies.broadcast.cleanupTenantEmitter(input.projectId);
    }
  }

  // ── Studio writes ──────────────────────────────────────────────

  /** Creates the workflow a new wizard experiment writes its versions into. */
  createWorkflow(
    input: Readonly<{
      projectId: string;
      name: string;
      icon?: string | null;
      description?: string | null;
    }>,
  ): Promise<Readonly<{ id: string }>> {
    return this.#dependencies.workflowAuthoring.create(input);
  }

  /** Writes a workflow version, autosaved or committed. */
  saveWorkflowVersion(input: ExperimentWorkflowVersionInput): Promise<void> {
    return this.#dependencies.workflowAuthoring.saveVersion(input);
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
    return this.#dependencies.monitors.upsertForExperiment(input);
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
    return this.#dependencies.permissions.mayManageEvaluations(input);
  }

  /** The project's own model cost rules, for the optimizer log's pricing. */
  listModelCosts(input: Readonly<{ projectId: string }>): Promise<readonly ModelCostRate[]> {
    return this.#dependencies.modelCosts.listFor(input);
  }

  /** The display names behind the author ids on a version history. */
  resolveAuthorNames(
    authorIds: readonly string[],
  ): Promise<ReadonlyArray<Readonly<{ id: string; name: string | null }>>> {
    if (authorIds.length === 0) return Promise.resolve([]);

    return this.#dependencies.people.namesOf(authorIds);
  }

  /**
   * The stored attribution for one caller.
   */
  private static actorFor(by: ExperimentCaller): WorkbenchActor {
    if (by.kind === "user") return { userId: by.id, label: "user" };
    return workbenchActorFrom({ credential: by.credential });
  }
}
