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
  generateHumanReadableId,
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
  ExperimentEvaluationInputError,
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { z } from "zod";

import type {
  ExperimentV3RunLoop,
  ExperimentWorkbenchObserver,
} from "../app/experiment-workbench.members.ts";
import { mapThrownErrorEvent } from "../eventing/experiment-result-mapping.process.ts";
import { runLoopOf, runProgressOf } from "../rules/experiment-run-loop.rules.ts";
import { workbenchActorFrom } from "../rules/experiment-workbench-actor.rules.ts";
import { ExperimentExecutionDataService } from "./experiment-execution-data.service.ts";
import { ExperimentResultDispatchService } from "./experiment-result-dispatch.service.ts";
import { ExperimentRunOrchestratorService } from "./experiment-run-orchestrator.service.ts";
import { ExperimentRunPlanService } from "./experiment-run-plan.service.ts";
import { ExperimentSavedStateExecutionService } from "./experiment-saved-state-execution.service.ts";
import {
  ExperimentWorkbenchPipelineRunService,
  type WorkbenchRunPipeline,
} from "./experiment-workbench-pipeline-run.service.ts";
import type { ExperimentService } from "./experiment.service.ts";

const logger = createLogger("langwatch:experiments-v3");

export type WorkbenchExecutionRequest = z.infer<typeof executionRequestSchema>;

type WorkbenchRunDeps = {
  experiments: ExperimentService;
  runLoop: ExperimentV3RunLoop;
  observer: ExperimentWorkbenchObserver;
  /** Absent where a suite builds no run pipeline; a pipeline run is then refused by name. */
  runs?: WorkbenchRunPipeline;
};

export class ExperimentWorkbenchRunService {
  private readonly experiments: ExperimentService;
  private readonly runLoop: ExperimentV3RunLoop;
  private readonly observer: ExperimentWorkbenchObserver;
  private readonly runs: WorkbenchRunPipeline | undefined;

  private constructor(deps: WorkbenchRunDeps) {
    this.experiments = deps.experiments;
    this.runLoop = deps.runLoop;
    this.observer = deps.observer;
    this.runs = deps.runs;
  }

  static create(deps: WorkbenchRunDeps): ExperimentWorkbenchRunService {
    return new ExperimentWorkbenchRunService(deps);
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
      throw new ExperimentEvaluationInputError({ status: 400, reason: "No dataset configured" });
    }

    let rawBody: unknown = {};
    if (input.body.trim()) {
      try {
        rawBody = JSON.parse(input.body);
      } catch {
        throw new ExperimentEvaluationInputError({ status: 400, reason: "Invalid JSON body" });
      }
    }
    const inputsParse = runInputsBodySchema.safeParse(rawBody);
    if (!inputsParse.success) {
      const error = inputsParse.error.issues[0]?.message ?? "Invalid request body";
      throw new ExperimentEvaluationInputError({ status: 400, reason: error });
    }
    const runInputs = inputsParse.data;

    const prepared = await ExperimentSavedStateExecutionService.create().prepareSavedStateExecution(
      {
        experiments: this.experiments,
        services: this.runLoop.services,
        projectId,
        slug,
        runInputs: {
          data: runInputs.data,
          datasetId: runInputs.dataset_id,
          parameters: runInputs.parameters,
        },
      },
    );
    if ("error" in prepared) {
      throw new ExperimentEvaluationInputError({ status: prepared.status, reason: prepared.error });
    }

    const scope: ExecutionScope = runInputs.row_indices
      ? { type: "rows", rowIndices: runInputs.row_indices }
      : { type: "full" };
    const carriedOverCells = ExperimentSavedStateExecutionService.create().planSavedRunCarryOver({
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
      const orchestrator = ExperimentRunOrchestratorService.create().runOrchestrator({
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

  /** `POST /execute`: the browser's run, planned here and executed by the worker's run pipeline. */
  async executeWorkbenchRun(
    input: WorkbenchExecutionRequest,
    by: Readonly<{ id: string }>,
  ): Promise<WorkbenchRunAnswer> {
    const { projectId } = input;

    logger.info({ projectId, scope: input.scope }, "Starting experiment execution");

    // The refusal a process without Redis or a public address owes, as before the pipeline.
    const { ports } = runLoopOf(this.runLoop);
    const runs = this.#pipeline();

    const dataResult = await ExperimentExecutionDataService.create().loadExecutionData({
      projectId,
      dataset: input.dataset,
      targets: input.targets,
      evaluators: input.evaluators,
      services: this.runLoop.services,
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
      concurrency: input.concurrency ?? this.runLoop.defaultConcurrency,
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
      events: ExperimentWorkbenchPipelineRunService.create({
        experiments: this.experiments,
        observer: this.observer,
        runs,
      }).streamRun({
        start: {
          tenantId: projectId,
          occurredAt: nowInstant().epochMilliseconds,
          runId: generateHumanReadableId(),
          experimentId,
          workflowVersionId: null,
          total: plan.cells.length,
          targets: ExperimentResultDispatchService.create().buildTargetMetadata({
            targets: state.targets,
            loadedPrompts: dataResult.loadedPrompts,
            loadedAgents: dataResult.loadedAgents,
            loadedEvaluators: dataResult.loadedEvaluators,
            loadedWorkflows: dataResult.loadedWorkflows,
          }),
          plan,
        },
        ownership: ports.connectedAgentOwnership,
        data: dataResult,
        state,
        input,
        userId: by.id,
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

  #pipeline(): WorkbenchRunPipeline {
    if (!this.runs) {
      throw new Error("Experiment was asked to start a run on its pipeline, but none was built");
    }

    return this.runs;
  }
}

/** The page size a list asks for: 50 unless given, never above 200. */
function pageSizeOf(requested: number | undefined): number {
  return Math.min(requested ?? 50, 200);
}
