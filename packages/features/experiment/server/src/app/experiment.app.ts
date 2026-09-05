/**
 * The experiment feature's application: what both of its doors call.
 */
import type { ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import type { Dataset, DatasetService } from "@langwatch/dataset-contract";
import type {
  CommitWorkbenchVersionInput,
  CompleteExperimentRunInput,
  CreateEvaluationsV3Input,
  DSPyRunsSummary,
  Experiment,
  ExperimentDspyStep,
  ExperimentDspyStepLookup,
  ExperimentDspyStepsLookup,
  ExperimentLookup,
  ExperimentPage,
  ExperimentPageInput,
  ExperimentRun,
  ExperimentRunAggregate,
  ExperimentRunListInput,
  ExperimentRunLookup,
  ExperimentRunSlugPageInput,
  ExperimentRunWithItems,
  ExperimentService,
  ExperimentSlugLookup,
  ExperimentType,
  GetWorkbenchStateInput,
  ListWorkbenchVersionsInput,
  RecordEvaluatorResultInput,
  RecordTargetResultInput,
  RestoreWorkbenchVersionInput,
  SaveExperimentInput,
  SaveWorkbenchStateInput,
  StartExperimentRunInput,
  WorkbenchActor,
  WorkbenchSaveResult,
  WorkbenchStateView,
  WorkbenchVersionsPage,
} from "@langwatch/experiment-contract";
import {
  WorkflowNotFoundError,
  type WorkflowService,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import { createBlankWorkbenchState } from "../rules/experiment-blank-workbench-state.rules";
import { workbenchActorFrom } from "../rules/experiment-workbench-actor.rules";

/**
 * The project-scoped signal fan-out an editor tab follows. Declared as the two
 * methods the transports call: the emitter itself is the host's, shared with
 * every other subscription surface.
 */
export type ExperimentBroadcast = Readonly<{
  getTenantEmitter(projectId: string): NodeJS.EventEmitter;
  cleanupTenantEmitter(projectId: string): void;
}>;

/** The one monitor write an archive cascades into. */
export type ExperimentMonitorCascade = Readonly<{
  deleteForExperiment(
    input: Readonly<{ projectId: string; experimentId: string }>,
  ): Promise<unknown>;
}>;

/**
 * Who a workbench write is attributed to, in the one vocabulary both doors can
 * speak.
 */
export type ExperimentCaller =
  | Readonly<{ kind: "user"; id: string }>
  | Readonly<{ kind: "credential"; resolved: ResolvedApiKeyToken | null | undefined }>;

/** One experiment with the run history the list and read surfaces show beside it. */
export type ExperimentWithRuns = Readonly<{
  experiment: Experiment;
  runsCount: number;
  lastRunAt: number | null;
}>;

/** What the process composes this feature's application from. */
export interface ExperimentAppDependencies {
  experiments: ExperimentService;
  workflows: WorkflowService;
  dataset: DatasetService;
  monitors: ExperimentMonitorCascade;
  broadcast: ExperimentBroadcast;
}

/** An experiment nobody has run yet. Defaulted here so no door decides it. */
const NO_RUNS: ExperimentRunAggregate = { runsCount: 0, lastRunAt: null };

export class ExperimentApp {
  static create(dependencies: ExperimentAppDependencies): ExperimentApp {
    return new ExperimentApp(dependencies);
  }

  private constructor(private readonly dependencies: ExperimentAppDependencies) {}

  /**
   * The service itself, for the process functions that still take it whole.
   */
  get experimentService(): ExperimentService {
    return this.dependencies.experiments;
  }

  // ── Experiments ────────────────────────────────────────────────

  /** Every active experiment in the project. */
  list(input: Readonly<{ projectId: string }>): Promise<Experiment[]> {
    return this.dependencies.experiments.list(input);
  }

  /** One page of the project's experiments. */
  getPage(input: ExperimentPageInput): Promise<ExperimentPage> {
    return this.dependencies.experiments.getPage(input);
  }

  /** One experiment by id. */
  getById(input: ExperimentLookup): Promise<Experiment> {
    return this.dependencies.experiments.getById(input);
  }

  /** One experiment by id, or null when it is archived or absent. */
  tryGetById(input: ExperimentLookup): Promise<Experiment | null> {
    return this.dependencies.experiments.tryGetById(input);
  }

  /** One experiment by slug. */
  getBySlug(input: ExperimentSlugLookup): Promise<Experiment> {
    return this.dependencies.experiments.getBySlug(input);
  }

  /**
   * One experiment by slug, or null when the project has none by that name.
   */
  tryGetBySlug(input: ExperimentSlugLookup): Promise<Experiment | null> {
    return this.dependencies.experiments.tryGetBySlug(input);
  }

  /**
   * One experiment by slug, only when it is of the kind the caller expects.
   */
  tryGetBySlugAndType(
    input: ExperimentSlugLookup & Readonly<{ type: ExperimentType }>,
  ): Promise<Experiment | null> {
    return this.dependencies.experiments.tryGetBySlugAndType(input);
  }

  /** One experiment's id and slug, for a caller that holds only the slug. */
  tryGetIdBySlug(input: ExperimentSlugLookup): Promise<{ id: string; slug: string } | null> {
    return this.dependencies.experiments.tryGetIdBySlug(input);
  }

  /**
   * Whether the experiment is still live — present and not archived.
   */
  isActive(input: ExperimentLookup): Promise<boolean> {
    return this.dependencies.experiments.isActive(input);
  }

  /** One experiment by whichever identifier the caller holds. */
  getBySlugOrId(input: Readonly<{ projectId: string; slugOrId: string }>): Promise<Experiment> {
    return this.dependencies.experiments.getBySlugOrId(input);
  }

  /** The project's most recent experiment, or null when it has none. */
  tryGetLatest(input: Readonly<{ projectId: string }>): Promise<Experiment | null> {
    return this.dependencies.experiments.tryGetLatest(input);
  }

  /** The name the next unnamed experiment in the project gets. */
  findNextDraftName(input: Readonly<{ projectId: string }>): Promise<string> {
    return this.dependencies.experiments.findNextDraftName(input);
  }

  /** Creates or replaces an experiment. */
  save(input: SaveExperimentInput): Promise<Experiment> {
    return this.dependencies.experiments.save(input);
  }

  /**
   * Archives an experiment, and with it the workflow it wrote versions into and
   * the monitor it was published as.
   */
  async archive(input: ExperimentLookup): Promise<{ success: true }> {
    const experiment = await this.dependencies.experiments.tryGetById(input);
    const result = await this.dependencies.experiments.archive(input);

    if (experiment?.workflowId) {
      await this.dependencies.workflows.archive({
        id: experiment.workflowId,
        projectId: input.projectId,
      });
    }
    if (experiment) {
      await this.dependencies.monitors.deleteForExperiment({
        projectId: input.projectId,
        experimentId: input.id,
      });
    }

    return result;
  }

  // ── Runs ───────────────────────────────────────────────────────

  /** The runs of each named experiment, keyed by experiment id. */
  listRuns(input: ExperimentRunListInput): Promise<Record<string, ExperimentRun[]>> {
    return this.dependencies.experiments.listRuns(input);
  }

  /** One run of one experiment. A missing run reads as null. */
  tryGetRun(input: ExperimentRunLookup): Promise<ExperimentRunWithItems | null> {
    return this.dependencies.experiments.tryGetRun(input);
  }

  /**
   * One page of an experiment's runs, addressed by slug.
   */
  getRunsPageBySlug(input: ExperimentRunSlugPageInput): Promise<{
    experiment: { id: string; slug: string };
    runs: ExperimentRun[];
    totalHits: number;
  }> {
    return this.dependencies.experiments.getRunsPageBySlug(input);
  }

  /**
   * The named experiments with their run count and latest run beside them.
   */
  async withRunAggregates(
    input: Readonly<{ projectId: string; experiments: readonly Experiment[] }>,
  ): Promise<ExperimentWithRuns[]> {
    if (input.experiments.length === 0) return [];

    const aggregates = await this.dependencies.experiments.getRunAggregates({
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
    return this.dependencies.experiments.startExperimentRun(input);
  }

  /** One target's output for one dataset row. */
  recordTargetResult(input: RecordTargetResultInput): Promise<void> {
    return this.dependencies.experiments.recordTargetResult(input);
  }

  /** One evaluator's verdict on one target's output. */
  recordEvaluatorResult(input: RecordEvaluatorResultInput): Promise<void> {
    return this.dependencies.experiments.recordEvaluatorResult(input);
  }

  /** Closes a run, whether it finished or was stopped. */
  completeExperimentRun(input: CompleteExperimentRunInput): Promise<void> {
    return this.dependencies.experiments.completeExperimentRun(input);
  }

  // ── Optimization runs ──────────────────────────────────────────

  /** The optimization runs recorded against one experiment. */
  listDspyRuns(input: ExperimentDspyStepsLookup): Promise<DSPyRunsSummary[]> {
    return this.dependencies.experiments.listDspyRuns(input);
  }

  /** One optimization step. */
  getDspyStep(input: ExperimentDspyStepLookup): Promise<ExperimentDspyStep> {
    return this.dependencies.experiments.getDspyStep(input);
  }

  // ── Workbench ──────────────────────────────────────────────────

  /** The workbench state a page opens on. */
  getWorkbenchState(input: GetWorkbenchStateInput): Promise<WorkbenchStateView> {
    return this.dependencies.experiments.getWorkbenchState(input);
  }

  /** The version history of one experiment's workbench. */
  listWorkbenchVersions(input: ListWorkbenchVersionsInput): Promise<WorkbenchVersionsPage> {
    return this.dependencies.experiments.listWorkbenchVersions(input);
  }

  /** Writes the workbench, attributed to the caller who asked for it. */
  saveWorkbenchState(
    input: Omit<SaveWorkbenchStateInput, "actor">,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult> {
    return this.dependencies.experiments.saveWorkbenchState({
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
    return this.dependencies.experiments.createEvaluationsV3({
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
    return this.dependencies.experiments.commitWorkbenchVersion({
      ...input,
      actor: ExperimentApp.actorFor(by),
    });
  }

  /** Puts a past version back, attributed to the caller who asked for it. */
  restoreWorkbenchVersion(
    input: Omit<RestoreWorkbenchVersionInput, "actor">,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult> {
    return this.dependencies.experiments.restoreWorkbenchVersion({
      ...input,
      actor: ExperimentApp.actorFor(by),
    });
  }

  // ── Workflows ──────────────────────────────────────────────────

  /**
   * The workflow behind an experiment, or null when it is gone.
   */
  async tryGetWorkflow(
    input: Readonly<{ id: string; projectId: string; includeVersion?: boolean }>,
  ): Promise<WorkflowWithVersion | null> {
    try {
      return await this.dependencies.workflows.getById(input);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return null;
      throw error;
    }
  }

  // ── Datasets ───────────────────────────────────────────────────

  /** The named datasets of one project. */
  getDatasets(input: Readonly<{ projectId: string; datasetIds: string[] }>): Promise<Dataset[]> {
    return this.dependencies.dataset.getByIds(input);
  }

  /** Renames one dataset, so a renamed experiment's datasets follow it. */
  renameDataset(
    input: Readonly<{ datasetId: string; projectId: string; name: string }>,
  ): Promise<Dataset> {
    return this.dependencies.dataset.renameDataset(input);
  }

  /** Copies a dataset into another project. */
  copyDataset(
    input: Readonly<{
      sourceDatasetId: string;
      sourceProjectId: string;
      targetProjectId: string;
    }>,
  ): Promise<Dataset> {
    return this.dependencies.dataset.copyDataset(input);
  }

  // ── Broadcast ──────────────────────────────────────────────────

  /** The project's signal fan-out, for a tab following workbench writes. */
  getTenantEmitter(projectId: string): NodeJS.EventEmitter {
    return this.dependencies.broadcast.getTenantEmitter(projectId);
  }

  /** Releases the fan-out once the last subscriber has gone. */
  cleanupTenantEmitter(projectId: string): void {
    this.dependencies.broadcast.cleanupTenantEmitter(projectId);
  }

  /**
   * The stored attribution for one caller.
   */
  private static actorFor(by: ExperimentCaller): WorkbenchActor {
    if (by.kind === "user") return { userId: by.id, label: "user" };
    return workbenchActorFrom({ resolved: by.resolved });
  }
}
