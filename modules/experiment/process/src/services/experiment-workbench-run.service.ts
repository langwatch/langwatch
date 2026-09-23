/**
 * A workbench run as the `/api/experiments` doors drive it: a saved run started
 * or streamed by slug, a browser run streamed from the posted setup, and the
 * reads a CI job polls. Refusals main published as `{ error }` stay answers.
 */
import {
  ExperimentNotFoundError,
  ExperimentRunNotFoundError as RunNotFoundError,
  InvalidExperimentConfigurationError,
  createInitialUIState,
  persistedEvaluationsV3StateSchema,
  runInputsBodySchema,
  runsSavedDataset,
  type EvaluationV3Event,
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
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { z } from "zod";

import type {
  ExperimentV3RunLoop,
  ExperimentWorkbenchObserver,
} from "../app/experiment-workbench.members.ts";
import { mapThrownErrorEvent } from "../eventing/experiment-result-mapping.process.ts";
import { runLoopOf, runProgressOf } from "../rules/experiment-run-loop.rules.ts";
import { workbenchActorFrom } from "../rules/experiment-workbench-actor.rules.ts";
import { ExperimentExecutionDataService } from "./experiment-execution-data.service.ts";
import { ExperimentRunOrchestratorService } from "./experiment-run-orchestrator.service.ts";
import { ExperimentRunResultsWriterService } from "./experiment-run-results-writer.service.ts";
import { ExperimentRunStateMirrorService } from "./experiment-run-state-mirror.service.ts";
import { ExperimentSavedStateExecutionService } from "./experiment-saved-state-execution.service.ts";
import type { ExperimentService } from "./experiment.service.ts";

const logger = createLogger("langwatch:experiments-v3");

export type WorkbenchExecutionRequest = z.infer<typeof executionRequestSchema>;

export class ExperimentWorkbenchRunService {
  private constructor(
    private readonly experiments: ExperimentService,
    private readonly runLoop: ExperimentV3RunLoop,
    private readonly observer: ExperimentWorkbenchObserver,
  ) {}

  static create(options: {
    experiments: ExperimentService;
    runLoop: ExperimentV3RunLoop;
    observer: ExperimentWorkbenchObserver;
  }): ExperimentWorkbenchRunService {
    return new ExperimentWorkbenchRunService(
      options.experiments,
      options.runLoop,
      options.observer,
    );
  }

  /** `POST /:slug/run`: a polled run by default, a streamed one when the caller accepts events. */
  async startSavedRun(input: SavedRunRequest): Promise<SavedRunAnswer> {
    const { projectId, slug } = input;

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
      return { kind: "refused", status: 400, error: "No dataset configured" };
    }

    let rawBody: unknown = {};
    if (input.body.trim()) {
      try {
        rawBody = JSON.parse(input.body);
      } catch {
        return { kind: "refused", status: 400, error: "Invalid JSON body" };
      }
    }
    const inputsParse = runInputsBodySchema.safeParse(rawBody);
    if (!inputsParse.success) {
      const error = inputsParse.error.issues[0]?.message ?? "Invalid request body";
      return { kind: "refused", status: 400, error };
    }
    const runInputs = inputsParse.data;

    const prepared = await ExperimentSavedStateExecutionService.prepareSavedStateExecution({
      experiments: this.experiments,
      services: this.runLoop.services,
      projectId,
      slug,
      runInputs: {
        data: runInputs.data,
        datasetId: runInputs.dataset_id,
        parameters: runInputs.parameters,
      },
    });
    if ("error" in prepared) {
      return { kind: "refused", status: prepared.status, error: prepared.error };
    }

    const scope: ExecutionScope = runInputs.row_indices
      ? { type: "rows", rowIndices: runInputs.row_indices }
      : { type: "full" };
    const carriedOverCells = ExperimentSavedStateExecutionService.planSavedRunCarryOver({
      prepared,
      scope,
    });
    const {
      experiment,
      state,
      datasetRows,
      datasetColumns,
      loadedPrompts,
      loadedAgents,
      loadedEvaluators,
      loadedWorkflows,
    } = prepared;
    const loaded = {
      state,
      datasetRows,
      datasetColumns,
      loadedPrompts,
      loadedAgents,
      loadedEvaluators,
      loadedWorkflows,
    };

    logger.info(
      { projectId, slug, isSSE: input.acceptsEvents, rowCount: loaded.datasetRows.length },
      "Starting CI/CD experiment execution",
    );

    if (input.acceptsEvents) {
      const { ports } = runLoopOf(this.runLoop);
      const orchestrator = ExperimentRunOrchestratorService.runOrchestrator({
        projectId,
        experimentId: experiment.id,
        scope,
        ...loaded,
        ports,
        workflows: this.runLoop.workflows,
        defaultConcurrency: this.runLoop.defaultConcurrency,
        ...(carriedOverCells.length > 0 ? { carriedOverCells } : {}),
      });

      return { kind: "streaming", events: this.#savedRunEvents({ orchestrator, projectId, slug }) };
    }

    const { runId, runUrl, total } = await this.runLoop.startRun({
      projectId,
      projectSlug: input.projectSlug,
      experimentId: experiment.id,
      experimentSlug: slug,
      scope,
      ...loaded,
      ...(carriedOverCells.length > 0 ? { carriedOverCells } : {}),
      // A run of the saved dataset fills the cells the workbench shows.
      ...(runsSavedDataset(runInputs)
        ? {
            persistResults: {
              experiments: this.experiments,
              actor: workbenchActorFrom({ credential: input.credential }),
            },
          }
        : {}),
    });

    return { kind: "started", runId, status: "running", total, runUrl };
  }

  /** `POST /execute`: the browser's run, mirrored onto the run store and the saved cells. */
  async executeWorkbenchRun(
    input: WorkbenchExecutionRequest,
    by: Readonly<{ id: string }>,
  ): Promise<WorkbenchRunAnswer> {
    const { projectId } = input;

    logger.info({ projectId, scope: input.scope }, "Starting experiment execution");

    const { ports, progress } = runLoopOf(this.runLoop);

    const dataResult = await ExperimentExecutionDataService.loadExecutionData({
      projectId,
      dataset: input.dataset,
      targets: input.targets,
      evaluators: input.evaluators,
      services: this.runLoop.services,
      inputs: { data: input.data, datasetId: input.dataset_id, parameters: input.parameters },
    });
    if ("error" in dataResult) {
      return { kind: "refused", status: dataResult.status, error: dataResult.error };
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

    const mirror = ExperimentRunStateMirrorService.create({
      projectId,
      experimentId: input.experimentId,
      experimentSlug: input.experimentSlug ?? "",
      progress,
    });

    // The page saves these cells too, and it is the faster of the two. The
    // server writes them so the board does not depend on the tab surviving.
    const resultsWriter = ExperimentRunResultsWriterService.findWriterFor({
      persistence: { experiments: this.experiments, actor: { userId: by.id, label: "user" } },
      projectId,
      experimentId: input.experimentId,
      scope: input.scope,
      data: input.data,
      datasetId: input.dataset_id,
      parameters: input.parameters,
    });

    const orchestrator = ExperimentRunOrchestratorService.runOrchestrator({
      projectId,
      experimentId: input.experimentId,
      scope: input.scope,
      state,
      datasetRows: dataResult.datasetRows,
      datasetColumns: dataResult.datasetColumns,
      loadedPrompts: dataResult.loadedPrompts,
      loadedAgents: dataResult.loadedAgents,
      loadedEvaluators: dataResult.loadedEvaluators,
      loadedWorkflows: dataResult.loadedWorkflows,
      ports,
      workflows: this.runLoop.workflows,
      defaultConcurrency: this.runLoop.defaultConcurrency,
      concurrency: input.concurrency,
      seedTargetOutputs: input.seedTargetOutputs,
      carriedOverCells: input.carriedOverCells,
    });

    return {
      kind: "streaming",
      events: this.#workbenchRunEvents({
        orchestrator,
        projectId,
        experimentId: input.experimentId,
        isFullRun: input.scope.type === "full",
        userId: by.id,
        mirror,
        resultsWriter,
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
    const page = pageOf(input.page);

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

    const runState = await runProgressOf(this.runLoop).findRunState(runId);

    // All three not-found branches raise the SAME code: from outside they
    // are one answer - this run is not yours to read.
    if (!runState || runState.projectId !== input.projectId) throw new RunNotFoundError(runId);

    // A run whose owning experiment was archived must not keep serving status from the cache.
    if (runState.experimentId) {
      const stillLive = await this.experiments.isActive({
        projectId: input.projectId,
        id: runState.experimentId,
      });
      if (!stillLive) throw new RunNotFoundError(runId);
    }

    logger.debug({ runId, status: runState.status }, "Run status queried");

    if (runState.status === "running" || runState.status === "pending") {
      return {
        runId: runState.runId,
        status: runState.status,
        progress: runState.progress,
        total: runState.total,
        startedAt: runState.startedAt,
      };
    }

    if (runState.status === "completed") {
      return {
        runId: runState.runId,
        status: runState.status,
        progress: runState.progress,
        total: runState.total,
        startedAt: runState.startedAt,
        finishedAt: runState.finishedAt,
        summary: runState.summary,
      };
    }

    if (runState.status === "failed") {
      return {
        runId: runState.runId,
        status: runState.status,
        progress: runState.progress,
        total: runState.total,
        startedAt: runState.startedAt,
        finishedAt: runState.finishedAt,
        // The code, never the thrown message (ADR-045).
        error: runState.error,
        ...(runState.domainError ? { domainError: runState.domainError } : {}),
        ...(runState.traceId ? { traceId: runState.traceId } : {}),
      };
    }

    return {
      runId: runState.runId,
      status: runState.status,
      progress: runState.progress,
      total: runState.total,
      startedAt: runState.startedAt,
      finishedAt: runState.finishedAt,
    };
  }

  /** `GET /runs/:runId/results`: every row of a run, found through the cache or the slug. */
  async readRunResults(input: RunResultsRequest): Promise<ExperimentRunWithItems> {
    const { projectId, runId } = input;

    const runState = await runProgressOf(this.runLoop).findRunState(runId);
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

  /** The `:slug/run` stream: the same orchestrator, with no mirror or writer. */
  async *#savedRunEvents(options: {
    orchestrator: AsyncIterable<EvaluationV3Event>;
    projectId: string;
    slug: string;
  }): AsyncGenerator<EvaluationV3Event> {
    const { projectId, slug } = options;

    try {
      for await (const event of options.orchestrator) {
        yield event;
        if (event.type === "done" || event.type === "stopped") break;
      }
    } catch (error) {
      logger.error({ error, projectId, slug }, "Orchestrator error");
      this.observer.reportError(error, { projectId, slug });
      yield mapThrownErrorEvent({ error });
    }
  }

  /** The `execute` stream: the board first, then the run store, then the customer. */
  async *#workbenchRunEvents(options: {
    orchestrator: AsyncIterable<EvaluationV3Event>;
    projectId: string;
    experimentId: string | undefined;
    isFullRun: boolean;
    userId: string;
    mirror: ReturnType<typeof ExperimentRunStateMirrorService.create>;
    resultsWriter: ReturnType<typeof ExperimentRunResultsWriterService.findWriterFor>;
  }): AsyncGenerator<EvaluationV3Event> {
    const { projectId, mirror, resultsWriter } = options;

    try {
      for await (const event of options.orchestrator) {
        await resultsWriter?.record(event);
        await mirror.record(event);
        yield event;

        if (event.type === "done" || event.type === "stopped") {
          this.observer.recordExperimentRan({
            userId: options.userId,
            projectId,
            experimentId: options.experimentId,
            isFullRun: options.isFullRun,
          });
          break;
        }
      }
    } catch (error) {
      logger.error({ error, projectId }, "Orchestrator error");
      this.observer.reportError(error, { projectId });

      const failure = mapThrownErrorEvent({ error });
      if (failure.type === "error") {
        await mirror.fail({
          code: failure.message,
          domainError: failure.domainError,
          traceId: failure.traceId,
        });
      }
      yield failure;
    }
  }
}

/** The page size a list asks for: 50 unless a positive number, never above 200. */
function pageSizeOf(raw: string | undefined): number {
  const parsed = raw ? parseInt(raw, 10) : 50;
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;

  return Math.min(parsed, 200);
}

/** The 1-based page a list asks for, falling back to the first. */
function pageOf(raw: string | undefined): number {
  const parsed = raw ? parseInt(raw, 10) : 1;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
