/**
 * CI/CD Evaluation Execution Endpoint
 *
 * POST /api/evaluations/v3/{slug}/run
 *
 * Starts execution of a saved Evaluations V3 experiment by slug.
 * Authenticates via API key (X-Auth-Token or Authorization header).
 *
 * Response modes:
 * - Default: Returns { runId, status } immediately for polling
 * - SSE: Add "Accept: text/event-stream" header for real-time streaming
 */

import { ExperimentType } from "@prisma/client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { handle } from "hono/vercel";
import type { z } from "zod";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import {
  createInitialUIState,
  type EvaluationsV3State,
} from "~/evaluations-v3/types";
import { persistedEvaluationsV3StateSchema } from "~/evaluations-v3/types/persistence";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { prisma } from "~/server/db";
import { loadExecutionData } from "~/server/evaluations-v3/execution/dataLoader";
import { runOrchestrator } from "~/server/evaluations-v3/execution/orchestrator";
import { runStateManager } from "~/server/evaluations-v3/execution/runStateManager";
import type { EvaluationV3Event } from "~/server/evaluations-v3/execution/types";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:evaluations-v3:run");

const app = new Hono().basePath("/api/evaluations/v3");
app.use(tracerMiddleware({ name: "evaluations-v3-run" }));
app.use(loggerMiddleware());

/**
 * Helper to authenticate via API key
 */
const authenticateApiKey = async (c: {
  req: { header: (name: string) => string | undefined };
}) => {
  const apiKey =
    c.req.header("X-Auth-Token") ??
    c.req.header("Authorization")?.split(" ")[1];

  if (!apiKey) {
    return { error: "Missing API key", status: 401 as const };
  }

  const project = await prisma.project.findUnique({
    where: { apiKey, archivedAt: null },
  });

  if (!project) {
    return { error: "Invalid API key", status: 401 as const };
  }

  return { project };
};

/**
 * Load and validate the experiment by slug
 */
const loadExperiment = async (projectId: string, slug: string) => {
  const experiment = await prisma.experiment.findFirst({
    where: {
      projectId,
      slug,
      type: ExperimentType.EVALUATIONS_V3,
    },
  });

  if (!experiment) {
    return { error: "Evaluation not found", status: 404 as const };
  }

  // Parse and validate workbenchState
  const parseResult = persistedEvaluationsV3StateSchema.safeParse(
    experiment.workbenchState,
  );
  if (!parseResult.success) {
    logger.error(
      { slug, errors: parseResult.error.errors },
      "Invalid workbenchState",
    );
    return { error: "Invalid evaluation configuration", status: 400 as const };
  }

  return { experiment, workbenchState: parseResult.data };
};

/**
 * Build state object for orchestrator
 */
const buildState = (
  workbenchState: z.infer<typeof persistedEvaluationsV3StateSchema>,
): EvaluationsV3State => {
  const dataset = workbenchState.datasets[0]!;

  return {
    name: workbenchState.name,
    datasets: workbenchState.datasets as EvaluationsV3State["datasets"],
    activeDatasetId: dataset.id ?? "dataset-1",
    targets: workbenchState.targets as EvaluationsV3State["targets"],
    evaluators: workbenchState.evaluators as EvaluationsV3State["evaluators"],
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
};

/**
 * Generate run URL for the UI
 */
const getRunUrl = (
  projectSlug: string,
  experimentSlug: string,
  runId: string,
) => {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://app.langwatch.ai";
  return `${baseUrl}/${projectSlug}/experiments/${experimentSlug}?runId=${runId}`;
};

/**
 * Run evaluation - supports both polling (default) and SSE modes
 */
app.post("/:slug/run", async (c) => {
  const { slug } = c.req.param();

  // Authenticate
  const authResult = await authenticateApiKey(c);
  if ("error" in authResult) {
    return c.json({ error: authResult.error }, { status: authResult.status });
  }
  const { project } = authResult;

  // Load experiment
  const loadResult = await loadExperiment(project.id, slug);
  if ("error" in loadResult) {
    return c.json({ error: loadResult.error }, { status: loadResult.status });
  }
  const { experiment, workbenchState } = loadResult;

  // Get dataset config
  const dataset = workbenchState.datasets[0];
  if (!dataset) {
    return c.json({ error: "No dataset configured" }, { status: 400 });
  }

  // Load execution data using shared loader
  const dataResult = await loadExecutionData(
    project.id,
    dataset,
    workbenchState.targets,
    workbenchState.evaluators,
  );

  if ("error" in dataResult) {
    return c.json(
      { error: dataResult.error },
      { status: dataResult.status as 400 | 404 },
    );
  }

  const {
    datasetRows,
    datasetColumns,
    loadedPrompts,
    loadedAgents,
    loadedEvaluators,
  } = dataResult;

  // Build state for orchestrator
  const state = buildState(workbenchState);

  // Check if SSE mode is requested
  const acceptHeader = c.req.header("Accept") ?? "";
  const isSSE = acceptHeader.includes("text/event-stream");

  logger.info(
    { projectId: project.id, slug, isSSE, rowCount: datasetRows.length },
    "Starting CI/CD evaluation execution",
  );

  // Calculate total cells
  const totalCells = datasetRows.length * workbenchState.targets.length;

  if (isSSE) {
    // SSE streaming mode
    return streamSSE(c, async (stream) => {
      try {
        const orchestrator = runOrchestrator({
          projectId: project.id,
          experimentId: experiment.id,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: loadedPrompts as Map<string, VersionedPrompt>,
          loadedAgents: loadedAgents as Map<string, TypedAgent>,
          loadedEvaluators,
          saveToEs: true,
          featureEventSourcingEvaluationIngestion: project.featureEventSourcingEvaluationIngestion,
        });

        for await (const event of orchestrator) {
          await stream.writeSSE({
            data: JSON.stringify(event),
          });

          if (event.type === "done" || event.type === "stopped") {
            break;
          }
        }
      } catch (error) {
        logger.error(
          { error, projectId: project.id, slug },
          "Orchestrator error",
        );
        captureException(error, { extra: { projectId: project.id, slug } });

        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: (error as Error).message,
          }),
        });
      }
    });
  }

  // Polling mode - start in background and return runId
  // We need to run the orchestrator and update run state
  const runExecution = async (runId: string) => {
    try {
      const orchestrator = runOrchestrator({
        projectId: project.id,
        experimentId: experiment.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: loadedPrompts as Map<string, VersionedPrompt>,
        loadedAgents: loadedAgents as Map<string, TypedAgent>,
        loadedEvaluators,
        saveToEs: true,
        runId, // Pass the run ID we generated
        featureEventSourcingEvaluationIngestion: project.featureEventSourcingEvaluationIngestion,
      });

      for await (const event of orchestrator) {
        // Update run state in Redis
        await runStateManager.addEvent(runId, event as EvaluationV3Event);

        if (event.type === "done") {
          // Build extended summary for CI output
          const summary = {
            ...event.summary,
            runUrl: getRunUrl(project.slug, slug, runId),
          };
          await runStateManager.completeRun(runId, summary);
          break;
        }

        if (event.type === "stopped") {
          await runStateManager.stopRun(runId);
          break;
        }
      }
    } catch (error) {
      logger.error(
        { error, projectId: project.id, slug, runId },
        "Execution error",
      );
      captureException(error, {
        extra: { projectId: project.id, slug, runId },
      });
      await runStateManager.failRun(runId, (error as Error).message);
    }
  };

  // Create run state and start execution in background
  const runId = generateHumanReadableId();

  await runStateManager.createRun({
    runId,
    projectId: project.id,
    experimentId: experiment.id,
    experimentSlug: slug,
    total: totalCells,
  });

  // Start execution without awaiting (fire and forget)
  void runExecution(runId);

  return c.json({
    runId,
    status: "running",
    total: totalCells,
    runUrl: getRunUrl(project.slug, slug, runId),
  });
});

export const GET = handle(app);
export const POST = handle(app);
