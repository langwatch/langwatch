import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { handle } from "hono/vercel";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { captureException } from "~/utils/posthogErrorCapture";
import { executionRequestSchema } from "~/server/evaluations-v3/execution/types";
import { runOrchestrator, requestAbort } from "~/server/evaluations-v3/execution/orchestrator";
import { type EvaluationsV3State, createInitialUIState } from "~/evaluations-v3/types";
import { hasProjectPermission } from "~/server/api/rbac";
import { authOptions } from "~/server/auth";
import { prisma } from "~/server/db";
import { createLogger } from "~/utils/logger";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { z } from "zod";
import { PromptService, type VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { AgentService } from "~/server/agents/agent.service";
import { AgentRepository, type TypedAgent } from "~/server/agents/agent.repository";
import { getFullDataset } from "~/server/api/routers/datasetRecord";
import { transposeColumnsFirstToRowsFirstWithId } from "~/optimization_studio/utils/datasetUtils";

const logger = createLogger("langwatch:evaluations-v3:execute");

const app = new Hono().basePath("/api/evaluations/v3");
app.use(loggerMiddleware());

/**
 * Execute an evaluation run.
 * Streams SSE events back to the client as execution progresses.
 */
app.post(
  "/execute",
  zValidator("json", executionRequestSchema),
  async (c) => {
    const request = await c.req.json();
    const { projectId } = request;

    logger.info({ projectId, scope: request.scope }, "Starting evaluation execution");

    // Authenticate
    const session = await getServerSession(authOptions(c.req.raw as NextRequest));
    if (!session) {
      return c.json(
        { error: "You must be logged in to access this endpoint." },
        { status: 401 }
      );
    }

    // Authorize - use new RBAC system with evaluations:manage permission
    const hasPermission = await hasProjectPermission(
      { prisma, session },
      projectId,
      "evaluations:manage"
    );
    if (!hasPermission) {
      return c.json(
        { error: "You do not have permission to access this endpoint." },
        { status: 403 }
      );
    }

    // Load required data
    let datasetRows: Array<Record<string, unknown>>;
    let datasetColumns: Array<{ id: string; name: string; type: string }>;
    let loadedPrompts: Map<string, VersionedPrompt>;
    let loadedAgents: Map<string, TypedAgent>;

    try {
      // Load dataset
      const dataset = request.dataset;
      if (dataset.type === "inline" && dataset.inline) {
        datasetColumns = dataset.inline.columns;
        datasetRows = transposeColumnsFirstToRowsFirstWithId(dataset.inline.records);
      } else if (dataset.type === "saved" && dataset.datasetId) {
        const fullDataset = await getFullDataset({
          datasetId: dataset.datasetId,
          projectId,
          entrySelection: "all",
        });
        if (!fullDataset) {
          return c.json({ error: "Dataset not found" }, { status: 404 });
        }
        datasetColumns = dataset.columns;
        datasetRows = fullDataset.datasetRecords.map((r) => r.entry as Record<string, unknown>);
      } else {
        return c.json({ error: "Invalid dataset configuration" }, { status: 400 });
      }

      // Load prompts for prompt targets
      loadedPrompts = new Map();
      const promptService = new PromptService(prisma);
      for (const target of request.targets) {
        if (target.type === "prompt" && target.promptId) {
          // Use promptVersionNumber (numeric version like 12) not promptVersionId (string ID)
          try {
            const prompt = await promptService.getPromptByIdOrHandle({
              idOrHandle: target.promptId,
              projectId,
              version: target.promptVersionNumber ?? undefined,
            });
            if (prompt) {
              loadedPrompts.set(target.promptId, prompt);
            } else {
              const versionInfo = target.promptVersionNumber
                ? ` version ${target.promptVersionNumber}`
                : "";
              return c.json(
                { error: `Prompt "${target.name}"${versionInfo} not found` },
                { status: 404 }
              );
            }
          } catch (promptError) {
            const versionInfo = target.promptVersionNumber
              ? ` version ${target.promptVersionNumber}`
              : "";
            logger.error(
              { error: promptError, promptId: target.promptId, version: target.promptVersionNumber },
              "Failed to load prompt for target"
            );
            return c.json(
              { error: `Failed to load prompt "${target.name}"${versionInfo}: ${(promptError as Error).message}` },
              { status: 404 }
            );
          }
        }
      }

      // Load agents for agent targets
      loadedAgents = new Map();
      const agentService = AgentService.create(prisma);
      for (const target of request.targets) {
        if (target.type === "agent" && target.dbAgentId) {
          const agent = await agentService.getById({
            id: target.dbAgentId,
            projectId,
          });
          if (agent) {
            loadedAgents.set(target.dbAgentId, agent);
          }
        }
      }
    } catch (error) {
      logger.error({ error, projectId }, "Failed to load execution data");
      captureException(error, { extra: { projectId } });
      return c.json({ error: (error as Error).message }, { status: 500 });
    }

    // Build state object from request
    const state: EvaluationsV3State = {
      name: request.name,
      datasets: [request.dataset],
      activeDatasetId: request.dataset.id ?? "dataset-1",
      targets: request.targets as EvaluationsV3State["targets"],
      evaluators: request.evaluators as EvaluationsV3State["evaluators"],
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

    // Stream SSE events
    return streamSSE(c, async (stream) => {
      try {
        const orchestrator = runOrchestrator({
          projectId,
          experimentId: request.experimentId,
          scope: request.scope,
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts: loadedPrompts as any,
          loadedAgents: loadedAgents as any,
          saveToEs: !!request.experimentId,
        });

        for await (const event of orchestrator) {
          await stream.writeSSE({
            data: JSON.stringify(event),
          });

          // End stream on done or stopped
          if (event.type === "done" || event.type === "stopped") {
            break;
          }
        }
      } catch (error) {
        logger.error({ error, projectId }, "Orchestrator error");
        captureException(error, { extra: { projectId } });

        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: (error as Error).message,
          }),
        });
      }
    });
  }
);

/**
 * Abort a running evaluation.
 */
app.post(
  "/abort",
  zValidator(
    "json",
    z.object({
      projectId: z.string(),
      runId: z.string(),
    })
  ),
  async (c) => {
    const { projectId, runId } = await c.req.json();

    // Authenticate
    const session = await getServerSession(authOptions(c.req.raw as NextRequest));
    if (!session) {
      return c.json(
        { error: "You must be logged in to access this endpoint." },
        { status: 401 }
      );
    }

    // Authorize - use new RBAC system with evaluations:manage permission
    const hasPermission = await hasProjectPermission(
      { prisma, session },
      projectId,
      "evaluations:manage"
    );
    if (!hasPermission) {
      return c.json(
        { error: "You do not have permission to access this endpoint." },
        { status: 403 }
      );
    }

    logger.info({ projectId, runId }, "Requesting abort");
    await requestAbort(runId);

    return c.json({ success: true });
  }
);

export const GET = handle(app);
export const POST = handle(app);
