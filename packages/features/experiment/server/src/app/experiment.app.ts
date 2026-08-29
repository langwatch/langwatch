/**
 * The experiment feature's application: what both of its doors call.
 *
 * It holds every service and port the feature needs — the experiment service
 * itself plus the workflow, dataset, monitor and broadcast collaborators an
 * experiment still reaches through the host — and it is the one typed thing a
 * transport is given. Before it, the tRPC door declared a private
 * `Readonly<{ experiments, workflows, dataset, monitors, broadcast }>` bag and
 * the REST door took a bare `() => ExperimentService`: two descriptions of one
 * application, and neither reachable from the other.
 *
 * Most operations are the service's own. What lives here as a rule is what a
 * door would otherwise have to know, and did:
 *
 *   - attributing a workbench write to its caller — stamped in four places
 *     (three in tRPC, one in REST);
 *   - reading a workflow that may be gone — `.catch(tryWorkflow)` in four
 *     tRPC handlers;
 *   - what an experiment with no runs aggregates to — defaulted twice in the
 *     REST list and read routes;
 *   - what archiving an experiment cascades into — the workflow and the
 *     monitor, sequenced inside a tRPC mutation.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import type { ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import type { Dataset, DatasetService } from "@langwatch/dataset-contract";
import type {
  CommitWorkbenchVersionInput,
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
  RestoreWorkbenchVersionInput,
  SaveExperimentInput,
  SaveWorkbenchStateInput,
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
import { createBlankWorkbenchState } from "../transport/api-rest/experiment.blank-workbench-state";
import { workbenchActorFrom } from "../transport/api-rest/experiment.workbench-actor";

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
 *
 * A signed-in person is named by their user id. A credential arrives as the
 * host resolved it, because what a key is attributed to — the user it was
 * minted for, and whether it is a Langy session — is read off the token and
 * nowhere else.
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
   *
   * None of them is an experiment door: the workbench run orchestrator
   * persists its cells through it, the DSPy and batch-evaluation uploads
   * find-or-create an experiment before writing run events into it, and the
   * saved-state execution helper resolves the experiment the run is built
   * from. Each declares a `ExperimentService` parameter, so a narrowed shape
   * will not do. Until they move, this getter is the seam that remains — the
   * same one `WorkflowApp.workflowService` keeps.
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
   *
   * Absence is a real answer beside {@link getBySlug} rather than instead of
   * it: a caller that names the slug itself — a batch-evaluation upload, a
   * poller — decides for itself what a miss means, while a caller reading a
   * slug out of its own URL wants the raise.
   */
  tryGetBySlug(input: ExperimentSlugLookup): Promise<Experiment | null> {
    return this.dependencies.experiments.tryGetBySlug(input);
  }

  /**
   * One experiment by slug, only when it is of the kind the caller expects.
   *
   * The type is part of the question, not a check afterwards: two experiments
   * in a project may share a slug across kinds, and a workbench route that
   * read the slug alone would happily open a batch-evaluation record it cannot
   * render.
   */
  tryGetBySlugAndType(
    input: ExperimentSlugLookup & Readonly<{ type: ExperimentType }>,
  ): Promise<Experiment | null> {
    return this.dependencies.experiments.tryGetBySlugAndType(input);
  }

  /** One experiment's id and slug, for a caller that holds only the slug. */
  tryGetIdBySlug(
    input: ExperimentSlugLookup,
  ): Promise<{ id: string; slug: string } | null> {
    return this.dependencies.experiments.tryGetIdBySlug(input);
  }

  /**
   * Whether the experiment is still live — present and not archived.
   *
   * A run's cached status outlives its experiment's archival, so every read
   * that answers from that cache asks this first; otherwise archive visibility
   * silently depends on how old the run is.
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
   * Archives an experiment, and with it the workflow it wrote versions into
   * and the monitor it was published as.
   *
   * The cascade is here rather than in the door because it is one act: an
   * archived experiment whose workflow is still live is not a state the
   * product has a name for, and a second door sequencing the same three writes
   * is a second chance to sequence them differently.
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
   *
   * The experiment comes back with the page because resolving the slug is
   * half the read: a caller paging by slug needs the id it resolved to in
   * order to say which experiment the 404 was about.
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
   *
   * An experiment nobody has run aggregates to {@link NO_RUNS} rather than to
   * a hole the caller has to fill, and an empty list asks the run store
   * nothing. Both doors' list and read routes decided that for themselves.
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
   *
   * A caller that sends no setup gets a workbench they can open, so the create
   * is usable on its own rather than only as step one of a create-then-save
   * pair. That default is a property of creating an experiment, not of the
   * transport it was created over.
   */
  createEvaluationsV3(
    input: Omit<CreateEvaluationsV3Input, "actor" | "state"> &
      Readonly<{ state?: CreateEvaluationsV3Input["state"] }>,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult> {
    const { state, ...rest } = input;
    return this.dependencies.experiments.createEvaluationsV3({
      ...rest,
      state: state ?? createBlankWorkbenchState({ ...(rest.name ? { name: rest.name } : {}) }),
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
   *
   * An experiment outliving its workflow is ordinary — archiving one leaves
   * the other's row behind — so every read of it treats absence as a value.
   * Four tRPC handlers said that for themselves.
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
  getDatasets(
    input: Readonly<{ projectId: string; datasetIds: string[] }>,
  ): Promise<Dataset[]> {
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
   *
   * The credential arm is `workbenchActorFrom`, which stays where it is: it is
   * a published export the host's own workbench routes still call, and this
   * reuses it rather than growing a second copy of the same rule.
   */
  private static actorFor(by: ExperimentCaller): WorkbenchActor {
    if (by.kind === "user") return { userId: by.id, label: "user" };
    return workbenchActorFrom({ resolved: by.resolved });
  }
}
