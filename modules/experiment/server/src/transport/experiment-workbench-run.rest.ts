/**
 * `/api/experiments/execute` and `/api/experiments/abort` - the two workbench
 * doors a BROWSER opens. They answer behind the session door, so the framework
 * authenticates the person before the handler runs; the project a run names
 * lives in the request body, which is why the scope is deferred and the
 * handler asks `evaluations:manage` about it.
 */
import { deferredScope } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestRawResult,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import {
  ExperimentRunNotFoundError as RunNotFoundError,
  createInitialUIState,
  executionRequestSchema,
  type EvaluationsV3State,
} from "@langwatch/experiment-contract";
import { z } from "zod";

import type { ExperimentRunPorts } from "../rules/experiment-run-input.rules.ts";
import { ExperimentRunOrchestratorService } from "../services/experiment-run-orchestrator.service.ts";
import { ExperimentExecutionDataService } from "../services/experiment-execution-data.service.ts";
import { ExperimentRunResultsWriterService } from "../services/experiment-run-results-writer.service.ts";
import { ExperimentRunStateMirrorService } from "../services/experiment-run-state-mirror.service.ts";
import { mapThrownErrorEvent } from "../processes/experiment-result-mapping.process.ts";
import { ExperimentV3RestApi, jsonAnswer, runLoopOf } from "./experiment-v3.rest.ts";

const logger = createLogger("langwatch:experiments-v3");

/**
 * Who the session door let in, read off the door's own answer. A project key
 * opens the same door, and it is nobody: these two routes are the browser's.
 */
export const experimentWorkbenchCaller = defineRestMiddleware(
  "experimentWorkbenchCaller",
  z.object({ userId: z.string().nullable() }),
);

const BODY_NAMES_THE_PROJECT =
  "the door authenticates the person and the project a run names arrives in the request body, " +
  "so the handler asks evaluations:manage about that project before anything is read or written";

/** The refusals the two doors have always answered with, word for word. */
const NOT_SIGNED_IN = "You must be logged in to access this endpoint.";
const NOT_PERMITTED = "You do not have permission to access this endpoint.";

/**
 * The person behind a workbench door and the permission they hold on the
 * project the body named, or the refusal in their place.
 */
async function permittedPerson({
  app,
  userId,
  projectId,
}: {
  app: ExperimentV3RestApi;
  userId: string | null;
  projectId: string;
}): Promise<{ userId: string } | Response> {
  if (!userId) return jsonAnswer({ error: NOT_SIGNED_IN }, 401);

  const permitted = await app.probeProjectPermission(
    { user: { id: userId } },
    projectId,
    "evaluations:manage",
  );

  if (!permitted) return jsonAnswer({ error: NOT_PERMITTED }, 403);

  return { userId };
}

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
  .withAccess(deferredScope({ reason: BODY_NAMES_THE_PROJECT }))
  .withRawResponse({ produces: "text/event-stream" })
  .withDocs({ hide: true })
  .withMiddleware(experimentWorkbenchCaller)
  .handle(async ({ app, input }, caller): Promise<RestRawResult> => {
    const { projectId } = input;

    logger.info({ projectId, scope: input.scope }, "Starting experiment execution");

    const person = await permittedPerson({ app, userId: caller.userId, projectId });
    if (person instanceof Response) return person;

    const { ports: runPorts, progress } = runLoopOf(app.run);

    const dataResult = await ExperimentExecutionDataService.loadExecutionData(
      projectId,
      input.dataset,
      input.targets,
      input.evaluators,
      app.run.services,
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
        actor: { userId: person.userId, label: "user" },
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
        userId: person.userId,
      }),
    };
  })

  // ── POST /abort ────────────────────────────────────────────────────────
  // The body is read unparsed: the two refusals below are this door's own
  // words, and they have been on the wire since before the rewrite.
  .post("/abort", "abortExperimentRun")
  .withRawBody("text", { mediaType: "application/json" })
  .withAccess(deferredScope({ reason: BODY_NAMES_THE_PROJECT }))
  .withRawResponse({ produces: "application/json" })
  .withDocs({ hide: true })
  .withMiddleware(experimentWorkbenchCaller)
  .handle(async ({ app, raw }, caller): Promise<RestRawResult> => {
    let body: { projectId?: string; runId?: string };
    try {
      body = JSON.parse(raw) as { projectId?: string; runId?: string };
    } catch {
      return jsonAnswer({ error: "Invalid request body" }, 400);
    }

    const { projectId, runId } = body;
    if (!projectId || !runId) {
      return jsonAnswer(
        { error: "Invalid request body", details: "projectId and runId are required" },
        400,
      );
    }

    const person = await permittedPerson({ app, userId: caller.userId, projectId });
    if (person instanceof Response) return person;

    const { ports: runPorts, progress } = runLoopOf(app.run);

    // The runId is attacker-controlled: verify it is owned by the authenticated project before
    // signaling an abort, or a caller could abort another tenant's run by guessing its id.
    const ownerProjectId =
      (await runPorts.abort.findRunningProjectId(runId)) ??
      (await progress.findRunState(runId))?.projectId;
    if (!ownerProjectId || ownerProjectId !== projectId) {
      throw new RunNotFoundError(runId);
    }

    logger.info({ projectId, runId }, "Requesting abort");
    await ExperimentRunOrchestratorService.requestAbort({ abort: runPorts.abort, runId });

    return jsonAnswer({ success: true, runId, message: "Abort requested" }, 200);
  })

  .build();

/**
 * The `execute` event stream: runs the orchestrator, mirrors every frame onto
 * the run store and the saved cells, and writes each one as an SSE frame.
 */
function executeEventStream(options: {
  app: ExperimentV3RestApi;
  projectId: string;
  input: z.infer<typeof executionRequestSchema>;
  state: EvaluationsV3State;
  datasetRows: unknown[];
  datasetColumns: unknown;
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
  loadedEvaluators: unknown;
  loadedWorkflows: unknown;
  runPorts: ExperimentRunPorts;
  mirror: ReturnType<typeof ExperimentRunStateMirrorService.create>;
  resultsWriter: ReturnType<typeof ExperimentRunResultsWriterService.findWriterFor>;
  userId: string;
}): ReadableStream {
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
          workflows: app.run.workflows,
          loadedEvaluators: options.loadedEvaluators,
          loadedWorkflows: options.loadedWorkflows,
          defaultConcurrency: app.run.defaultConcurrency,
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
