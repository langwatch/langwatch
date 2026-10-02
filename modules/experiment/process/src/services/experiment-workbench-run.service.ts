/**
 * A workbench run as the `/api/experiments` doors drive it: a saved run started
 * or streamed by slug, a browser run streamed from the posted setup, and the
 * reads a CI job polls. Refusals main published as `{ error }` stay answers.
 */
import {
  ExperimentNotFoundError,
  ExperimentRunLoopUnavailableError,
  ExperimentRunNotFoundError as RunNotFoundError,
  InvalidExperimentConfigurationError,
  createInitialUIState,
  generateHumanReadableId,
  persistedEvaluationsV3StateSchema,
  runsSavedDataset,
  type EvaluationsV3State,
  type ExecutionScope,
  type ExperimentRunWithItems,
  type RunResultsRequest,
  type RunStatusAnswer,
  type RunsPageAnswer,
  type RunsPageRequest,
  type SavedRunAnswer,
  type SavedRunRequest,
  type WorkbenchRunAnswer,
  type executionRequestSchema,
  ExperimentEvaluationInputError,
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { deriveRunActor } from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";
import type { z } from "zod";

import type {
  ExperimentRunProgressState,
  ExperimentRunStartRecord,
} from "../repositories/experiment-run-fold.repository.ts";
import type { ExperimentRunRefusal } from "../rules/experiment-run-availability.rules.ts";
import { getRunUrl } from "../rules/experiment-run-url.rules.ts";
import { workbenchActorFrom } from "../rules/experiment-workbench-actor.rules.ts";
import {
  ExperimentExecutionDataService,
  type LoadedExecutionData,
} from "./experiment-execution-data.service.ts";
import { ExperimentRunPlanService } from "./experiment-run-plan.service.ts";
import { ExperimentSavedStateExecutionService } from "./experiment-saved-state-execution.service.ts";
import type { ExperimentWorkbenchObserver } from "./experiment-workbench-observer.service.ts";
import {
  ExperimentWorkbenchPipelineRunService,
  type PipelineRunStart,
  type WorkbenchRunPipeline,
} from "./experiment-workbench-pipeline-run.service.ts";
import type { ExperimentService } from "./experiment.service.ts";

const logger = createLogger("langwatch:experiments-v3");

export type WorkbenchExecutionRequest = z.infer<typeof executionRequestSchema>;

type WorkbenchRunDeps = {
  experiments: ExperimentService;
  observer: ExperimentWorkbenchObserver;
  /** Absent where a suite builds no run pipeline; a pipeline run is then refused by name. */
  runs?: WorkbenchRunPipeline;
};

export class ExperimentWorkbenchRunService {
  private readonly experiments: ExperimentService;
  private readonly observer: ExperimentWorkbenchObserver;
  private readonly runs: WorkbenchRunPipeline | undefined;

  private constructor(deps: WorkbenchRunDeps) {
    this.experiments = deps.experiments;
    this.observer = deps.observer;
    this.runs = deps.runs;
  }

  static create(deps: WorkbenchRunDeps): ExperimentWorkbenchRunService {
    return new ExperimentWorkbenchRunService(deps);
  }

  /** `POST /:slug/run`: a polled run by default, a streamed one when the caller accepts events. */
  async startSavedRun(input: SavedRunRequest): Promise<SavedRunAnswer> {
    const { projectId, slug } = input;
    const saved = await this.#prepareSavedRun(input);

    logger.info(
      { projectId, slug, isSSE: input.acceptsEvents, rowCount: saved.data.datasetRows.length },
      "Starting CI/CD experiment execution",
    );

    // The refusal a process without Redis or a public address owes, as before the pipeline.
    const runs = this.#startable();
    const runId = generateHumanReadableId();
    const savedRun = (options: { persistResults: boolean; runUrl?: string }): PipelineRunStart => {
      const plan = ExperimentRunPlanService.create().buildPlan({
        request: { state: saved.state, scope: saved.scope },
        data: saved.data,
        concurrency: runs.concurrency,
        origin: "saved",
        actor: workbenchActorFrom({ credential: input.credential }),
        experimentSlug: slug,
        ...options,
      });
      return {
        start: this.#runsOn().startOf({
          projectId,
          runId,
          experimentId: saved.experimentId,
          plan,
          state: saved.state,
          data: saved.data,
        }),
        // The person behind a key; a personal agent refuses a key that names nobody, as main did.
        actor: deriveRunActor({
          userId: input.credential.kind === "legacyProjectKey" ? null : input.credential.userId,
          surfaceHeader: null,
        }),
        data: saved.data,
        state: saved.state,
        carriedOverCells: saved.carriedOverCells,
        reportContext: { projectId, slug },
      };
    };

    // A stream never wrote the board; a polled run of the saved dataset fills the cells it shows.
    if (input.acceptsEvents) {
      return {
        kind: "streaming",
        events: this.#runsOn().streamRun(savedRun({ persistResults: false })),
      };
    }
    const runUrl = this.#runUrl({ projectSlug: input.projectSlug, slug, runId });
    const run = savedRun({ persistResults: runsSavedDataset(saved.runInputs), runUrl });
    await this.#runsOn().startRun(run);

    return { kind: "started", runId, status: "running", total: run.start.total, runUrl };
  }

  /** The saved workbench, the body's run inputs and the data they load, or main's refusals. */
  async #prepareSavedRun(input: SavedRunRequest) {
    const { projectId, slug } = input;
    const runs = this.#pipeline();
    const savedExperiment = await this.experiments.findBySlugAndType({
      projectId,
      slug,
      type: "EVALUATIONS_V3",
    });
    if (!savedExperiment) throw new ExperimentNotFoundError(slug);

    const parseResult = persistedEvaluationsV3StateSchema.safeParse(savedExperiment.workbenchState);
    if (!parseResult.success) {
      logger.error({ slug, errors: parseResult.error.issues }, "Invalid workbenchState");
      throw new InvalidExperimentConfigurationError(slug);
    }
    if (!parseResult.data.datasets[0]) {
      throw new ExperimentEvaluationInputError({ status: 400, reason: "No dataset configured" });
    }
    const savedState = ExperimentSavedStateExecutionService.create();
    const runInputs = savedState.parseRunInputs({ body: input.body });
    const prepared = await savedState.prepareSavedStateExecution({
      experiments: this.experiments,
      services: runs.services,
      projectId,
      slug,
      runInputs: {
        data: runInputs.data,
        datasetId: runInputs.dataset_id,
        parameters: runInputs.parameters,
      },
    });
    if ("error" in prepared) {
      throw new ExperimentEvaluationInputError({ status: prepared.status, reason: prepared.error });
    }

    const scope: ExecutionScope = runInputs.row_indices
      ? { type: "rows", rowIndices: runInputs.row_indices }
      : { type: "full" };
    const data: LoadedExecutionData = {
      datasetRows: prepared.datasetRows,
      datasetColumns: prepared.datasetColumns,
      loadedPrompts: prepared.loadedPrompts,
      loadedAgents: prepared.loadedAgents,
      loadedEvaluators: prepared.loadedEvaluators,
      loadedWorkflows: prepared.loadedWorkflows,
    };
    return {
      experimentId: prepared.experiment.id,
      state: prepared.state,
      data,
      scope,
      runInputs,
      carriedOverCells: savedState.planSavedRunCarryOver({ prepared, scope }),
    };
  }

  /** `POST /execute`: the browser's run, planned here and executed by the worker's run pipeline. */
  async executeWorkbenchRun(
    input: WorkbenchExecutionRequest,
    by: Readonly<{ id: string }>,
  ): Promise<WorkbenchRunAnswer> {
    const { projectId } = input;

    logger.info({ projectId, scope: input.scope }, "Starting experiment execution");

    // The refusal a process without Redis or a public address owes, as before the pipeline.
    const runs = this.#startable();

    const dataResult = await ExperimentExecutionDataService.create().loadExecutionData({
      projectId,
      dataset: input.dataset,
      targets: input.targets,
      evaluators: input.evaluators,
      services: runs.services,
      inputs: { data: input.data, datasetId: input.dataset_id, parameters: input.parameters },
    });
    if ("error" in dataResult) {
      throw new ExperimentEvaluationInputError({
        status: dataResult.status,
        reason: dataResult.error,
      });
    }

    const state: EvaluationsV3State = {
      name: input.name,
      // The wire's column `type` is a plain string and the state's is the
      // narrowed union, which is the same widening the two casts below carry.
      datasets: [input.dataset as EvaluationsV3State["datasets"][number]],
      activeDatasetId: input.dataset.id ?? "dataset-1",
      targets: input.targets as EvaluationsV3State["targets"],
      evaluators: input.evaluators as EvaluationsV3State["evaluators"],
      results: {
        status: "running",
        targetOutputs: {},
        targetMetadata: {},
        evaluatorResults: {},
        errors: {},
      },
      pendingSavedChanges: {},
      ui: createInitialUIState(),
    };

    const experimentId = input.experimentId ?? "";
    const plan = ExperimentRunPlanService.create().buildPlan({
      request: {
        state,
        scope: input.scope,
        ...(input.seedTargetOutputs ? { seedTargetOutputs: input.seedTargetOutputs } : {}),
      },
      data: dataResult,
      concurrency: input.concurrency ?? runs.concurrency,
      origin: "workbench",
      // The page saves these cells too; the server writes them so the board outlives the tab.
      persistResults:
        experimentId !== "" &&
        runsSavedDataset({
          ...(input.data !== undefined ? { data: input.data } : {}),
          ...(input.dataset_id !== undefined ? { dataset_id: input.dataset_id } : {}),
          ...(input.parameters !== undefined ? { parameters: input.parameters } : {}),
        }),
      actor: { userId: by.id, label: "user" },
      ...(input.experimentSlug !== undefined ? { experimentSlug: input.experimentSlug } : {}),
    });

    return {
      kind: "streaming",
      events: this.#runsOn().streamRun({
        start: this.#runsOn().startOf({
          projectId,
          runId: generateHumanReadableId(),
          experimentId,
          plan,
          state,
          data: dataResult,
        }),
        actor: { id: by.id, label: "user" },
        data: dataResult,
        state,
        carriedOverCells: input.carriedOverCells ?? [],
        reportContext: { projectId },
        ran: {
          userId: by.id,
          projectId,
          experimentId: input.experimentId,
          isFullRun: input.scope.type === "full",
        },
      }),
    };
  }

  /** `GET /runs`: one page of an experiment's runs, newest first. */
  async listRunsPage(input: RunsPageRequest): Promise<RunsPageAnswer> {
    const { experimentSlug } = input;
    if (!experimentSlug) {
      return { status: 400, body: { error: "experimentSlug query parameter is required" } };
    }

    const pageSize = pageSizeOf(input.pageSize);
    const page = input.page ?? 1;

    const { experiment, runs, totalHits } = await this.experiments
      .getRunsPageBySlug({ projectId: input.projectId, experimentSlug, page, pageSize })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "experiment_not_found") {
          throw new ExperimentNotFoundError(experimentSlug);
        }
        throw error;
      });

    const offset = (page - 1) * pageSize;

    return {
      status: 200,
      body: {
        experimentId: experiment.id,
        experimentSlug: experiment.slug,
        runs,
        pagination: { page, pageSize, totalHits, hasMore: offset + runs.length < totalHits },
      },
    };
  }

  /** `GET /runs/:runId`: progress while going, a summary or failure code once finished. */
  async pollRun(input: { projectId: string; runId: string }): Promise<RunStatusAnswer> {
    const { runId } = input;

    const runState = await this.#progressOf(runId);
    const run = runState ?? (await this.#startOf(runId));

    // All three not-found branches raise the SAME code: from outside they
    // are one answer - this run is not yours to read.
    if (!run || run.projectId !== input.projectId) throw new RunNotFoundError(runId);

    // A run whose owning experiment was archived must not keep serving status from the cache.
    if (run.experimentId) {
      const stillLive = await this.experiments.isActive({
        projectId: input.projectId,
        id: run.experimentId,
      });
      if (!stillLive) throw new RunNotFoundError(runId);
    }

    // Started, not yet folded by the worker: main's just-registered run (spec section 7).
    if (!runState) {
      return { runId, status: "running", progress: 0, total: run.total, startedAt: run.startedAt };
    }

    logger.debug({ runId, status: runState.status }, "Run status queried");

    const { status, progress, total, startedAt } = runState;
    if (status === "running" || status === "pending") {
      return { runId: runState.runId, status, progress, total, startedAt };
    }

    const { finishedAt } = runState;
    if (status === "completed") {
      return {
        runId: runState.runId,
        status,
        progress,
        total,
        startedAt,
        finishedAt,
        summary: runState.summary,
      };
    }

    if (status === "failed") {
      return {
        runId: runState.runId,
        status,
        progress,
        total,
        startedAt,
        finishedAt,
        // The code, never the thrown message (ADR-045).
        error: runState.error,
        ...(runState.domainError ? { domainError: runState.domainError } : {}),
        ...(runState.traceId ? { traceId: runState.traceId } : {}),
      };
    }

    return { runId: runState.runId, status, progress, total, startedAt, finishedAt };
  }

  /** `GET /runs/:runId/results`: every row of a run, found through the cache or the slug. */
  async readRunResults(input: RunResultsRequest): Promise<ExperimentRunWithItems> {
    const { projectId, runId } = input;

    const runState = await this.#progressOf(runId);
    const ownState = runState && runState.projectId === projectId ? runState : undefined;

    const experimentSlug = input.experimentSlug ?? ownState?.experimentSlug;
    let experimentId = ownState?.experimentId;

    if (!experimentId && experimentSlug) {
      const experiment = await this.experiments.findIdBySlug({ projectId, slug: experimentSlug });
      experimentId = experiment?.id;
    } else if (experimentId) {
      const stillLive = await this.experiments.isActive({ projectId, id: experimentId });
      if (!stillLive) experimentId = undefined;
    }

    if (!experimentId) throw new RunNotFoundError(runId);

    try {
      const run = await this.experiments.findRun({ projectId, experimentId, runId });
      if (!run) throw new RunNotFoundError(runId);

      return run;
    } catch (error) {
      // Only a genuine miss is a 404 (ADR-045).
      if (HandledError.isHandled(error)) throw error;
      logger.error({ error, runId }, "Failed to fetch run results");
      throw error;
    }
  }

  /**
   * `POST /abort`: the run's own project may stop it, read from its progress fold; any other gets
   * main's 404. The flag is the cells' fast signal, the command the manager's durable record.
   */
  async abortRun(
    input: Readonly<{ projectId: string; runId: string }>,
    by: Readonly<{ id: string }>,
  ): Promise<{ success: true; runId: string; message: "Abort requested" }> {
    const { projectId, runId } = input;
    const runState = (await this.#progressOf(runId)) ?? (await this.#startOf(runId));
    if (!runState || runState.projectId !== projectId) throw new RunNotFoundError(runId);

    logger.info({ projectId, runId }, "Requesting abort");
    const runs = this.#pipeline();
    await runs.abort.requestAbort(runId);
    await runs.commands.abortExperimentRun({
      tenantId: projectId,
      occurredAt: nowInstant().epochMilliseconds,
      runId,
      experimentId: runState.experimentId,
      requestedBy: by.id,
    });

    return { success: true, runId, message: "Abort requested" };
  }

  /** The run's progress fold, by runId alone as main's poller keyed it. */
  async #progressOf(runId: string): Promise<ExperimentRunProgressState | undefined> {
    const runs = this.#pipeline();
    // The refusal a process without Redis owes: its runs could never be read back.
    refuse(runs.refusals.read);
    const read = await runs.folds.readRunProgress({ runId });

    return read.kind === "folded" ? read.state : undefined;
  }

  /** A polled run's recorded start, read while the worker has not folded it yet. */
  async #startOf(runId: string): Promise<ExperimentRunStartRecord | undefined> {
    const [start] = await this.#pipeline().folds.findRunStart({ runId });

    return start;
  }

  /** The link a polled run answers with, which a process with no public address cannot give. */
  #runUrl({
    projectSlug,
    slug,
    runId,
  }: {
    projectSlug: string;
    slug: string;
    runId: string;
  }): string {
    const baseUrl = this.#pipeline().publicBaseUrl;
    if (!baseUrl) {
      throw new ExperimentRunLoopUnavailableError({ capability: "public address" });
    }

    return getRunUrl({ baseUrl, projectSlug, experimentSlug: slug, runId });
  }

  /** The run pipeline, once this process may start a run on it. */
  #startable(): WorkbenchRunPipeline {
    const runs = this.#pipeline();
    refuse(runs.refusals.start);

    return runs;
  }

  #runsOn(): ExperimentWorkbenchPipelineRunService {
    return ExperimentWorkbenchPipelineRunService.create({
      experiments: this.experiments,
      observer: this.observer,
      runs: this.#pipeline(),
    });
  }

  #pipeline(): WorkbenchRunPipeline {
    if (!this.runs) {
      throw new Error("Experiment was asked to start a run on its pipeline, but none was built");
    }

    return this.runs;
  }
}

/** Refuses by the capability this process lacks, as the retired run loop did. */
function refuse(refusal: ExperimentRunRefusal | undefined): void {
  if (refusal) throw new ExperimentRunLoopUnavailableError(refusal);
}

/** The page size a list asks for: 50 unless given, never above 200. */
function pageSizeOf(requested: number | undefined): number {
  return Math.min(requested ?? 50, 200);
}
