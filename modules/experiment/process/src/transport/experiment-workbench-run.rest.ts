/**
 * `/api/experiments/execute` and `/api/experiments/abort` - the two workbench
 * doors a BROWSER opens, behind the session door. The project a run names
 * resolves `evaluations:manage` from the project in the body before either operation.
 */
import { defineRestRouter, MANAGEMENT_API_VERSION, type RestRawResult } from "@langwatch/api/rest";
import {
  abortExperimentRunRequestSchema,
  abortExperimentRunResponseSchema,
  createInitialUIState,
  executionRequestSchema,
  type EvaluationsV3State,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import type { z } from "zod";

import { mapThrownErrorEvent } from "../eventing/experiment-result-mapping.process.ts";
import type { ExperimentRunCollaborators } from "../rules/experiment-run-input.rules.ts";
import {
  ExperimentExecutionDataService,
  type LoadedExecutionData,
} from "../services/experiment-execution-data.service.ts";
import { ExperimentRunOrchestratorService } from "../services/experiment-run-orchestrator.service.ts";
import { ExperimentRunResultsWriterService } from "../services/experiment-run-results-writer.service.ts";
import { ExperimentRunStateMirrorService } from "../services/experiment-run-state-mirror.service.ts";
import { ExperimentV3RestApi, jsonAnswer, runLoopOf } from "./experiment-v3.rest.ts";

const logger = createLogger("langwatch:experiments-v3");

export const experimentWorkbenchRunRest = defineRestRouter(ExperimentV3RestApi)
  .withNamespace("experiments")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("browser")

  // ── POST /execute ──────────────────────────────────────────────────────
  // Kept out of the published document: no API client can present the browser
  // session this door opens on, so publishing it would document an endpoint
  // that answers 401 to everyone reading the reference.
  .post("/execute", "executeExperiment")
  .withInput(executionRequestSchema)
  .withPermission("evaluations:manage", { at: "route", param: "projectId" })
  .withRawResponse({ produces: "text/event-stream" })
  .withDocs({ hide: true })
  .handle(async ({ app, input, actor }): Promise<RestRawResult> => {
    const { projectId } = input;

    logger.info({ projectId, scope: input.scope }, "Starting experiment execution");

    const { ports: runPorts, progress } = runLoopOf(app.run());

    const dataResult = await ExperimentExecutionDataService.loadExecutionData(
      projectId,
      input.dataset,
      input.targets,
      input.evaluators,
      app.run().services,
      { data: input.data, datasetId: input.dataset_id, parameters: input.parameters },
    );

    if ("error" in dataResult) {
      return jsonAnswer({ error: dataResult.error }, dataResult.status);
    }

    const {
      datasetRows,
      datasetColumns,
      loadedPrompts,
      loadedAgents,
      loadedEvaluators,
      loadedWorkflows,
    } = dataResult;

    const state: EvaluationsV3State = {
      name: input.name,
      // The wire's column `type` is a plain string and the state's is the
      // narrowed union, which is the same widening the two casts below
      // already carry.
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
      persistence: {
        experiments: app.experiments().experimentService,
        actor: { userId: actor.id, label: "user" },
      },
      projectId,
      experimentId: input.experimentId,
      scope: input.scope,
      data: input.data,
      datasetId: input.dataset_id,
      parameters: input.parameters,
    });

    return {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
      body: executeEventStream({
        app,
        projectId,
        input,
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts,
        loadedAgents,
        loadedEvaluators,
        loadedWorkflows,
        runPorts,
        mirror,
        resultsWriter,
        userId: actor.id,
      }),
    };
  })

  // ── POST /abort ────────────────────────────────────────────────────────
  .post("/abort", "abortExperimentRun")
  .withInput(abortExperimentRunRequestSchema)
  .withPermission("evaluations:manage", { at: "route", param: "projectId" })
  .withOutput(abortExperimentRunResponseSchema)
  .withDocs({ hide: true })
  .handle(({ app, input }) => app.abortWorkbenchRun(input))

  .build();

/**
 * The `execute` event stream: runs the orchestrator, mirrors every frame onto
 * the run store and the saved cells, and writes each one as an SSE frame.
 */
function executeEventStream(
  options: {
    app: ExperimentV3RestApi;
    projectId: string;
    input: z.infer<typeof executionRequestSchema>;
    state: EvaluationsV3State;
    runPorts: ExperimentRunCollaborators;
    mirror: ReturnType<typeof ExperimentRunStateMirrorService.create>;
    resultsWriter: ReturnType<typeof ExperimentRunResultsWriterService.findWriterFor>;
    userId: string;
  } & LoadedExecutionData,
): ReadableStream {
  const { app, projectId, input, mirror, resultsWriter, userId } = options;
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const write = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        const isFullRun = input.scope.type === "full";

        const orchestrator = ExperimentRunOrchestratorService.runOrchestrator({
          projectId,
          experimentId: input.experimentId,
          scope: input.scope,
          state: options.state,
          datasetRows: options.datasetRows,
          datasetColumns: options.datasetColumns,
          loadedPrompts: options.loadedPrompts,
          loadedAgents: options.loadedAgents,
          ports: options.runPorts,
          workflows: app.run().workflows,
          loadedEvaluators: options.loadedEvaluators,
          loadedWorkflows: options.loadedWorkflows,
          defaultConcurrency: app.run().defaultConcurrency,
          concurrency: input.concurrency,
          seedTargetOutputs: input.seedTargetOutputs,
          carriedOverCells: input.carriedOverCells,
        });

        for await (const event of orchestrator) {
          // The board first, then the run store, then the customer.
          await resultsWriter?.record(event);
          await mirror.record(event);
          write(event);

          if (event.type === "done" || event.type === "stopped") {
            app.recordExperimentRan?.({
              userId,
              projectId,
              experimentId: input.experimentId,
              isFullRun,
            });
            break;
          }
        }
      } catch (error) {
        logger.error({ error, projectId }, "Orchestrator error");
        app.reportError?.(error, { projectId });

        const failure = mapThrownErrorEvent({ error });
        if (failure.type === "error") {
          await mirror.fail({
            code: failure.message,
            domainError: failure.domainError,
            traceId: failure.traceId,
          });
        }
        write(failure);
      } finally {
        controller.close();
      }
    },
  });
}
