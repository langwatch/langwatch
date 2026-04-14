/**
 * Hono routes for workflow endpoints.
 *
 * Replaces:
 * - POST /api/workflows/code-completion (Monaco code completion proxy)
 * - POST /api/workflows/post_event     (Studio backend event SSE stream)
 *
 * Both were already Hono apps in App Router route.ts files.
 */
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { zValidator } from "@hono/zod-validator";
import { generateText } from "ai";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { CompletionCopilot } from "monacopilot";
import { z } from "zod";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import {
  type StudioClientEvent,
  type StudioServerEvent,
  studioClientEventSchema,
} from "~/optimization_studio/types/events";
import { hasProjectPermission } from "~/server/api/rbac";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import type { NextRequest } from "next/server";

const logger = createLogger("langwatch:workflows");

export const app = new Hono().basePath("/api/workflows");
app.use(tracerMiddleware({ name: "workflows" }));
app.use(loggerMiddleware());

// ── POST /code-completion ────────────────────────────────────────────

app.post("/code-completion", async (c) => {
  const body = await c.req.json();

  const session = await getServerAuthSession({ req: c.req.raw as NextRequest });
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  const { projectId } = c.req.query();
  if (!projectId) {
    return c.json({ error: "Project ID is required." }, { status: 400 });
  }

  const hasPermission = await hasProjectPermission(
    { prisma, session },
    projectId,
    "workflows:manage",
  );
  if (!hasPermission) {
    return c.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 },
    );
  }

  const model = await getVercelAIModel(projectId);

  const copilot = new CompletionCopilot(undefined, {
    model: async (prompt) => {
      const { text } = await generateText({
        model,
        messages: [
          { role: "system", content: prompt.context },
          {
            role: "user",
            content: `${prompt.instruction}\n\n${prompt.fileContent}`,
          },
        ],
        maxOutputTokens: 64,
        temperature: 0,
        providerOptions: {
          openai: {
            reasoningEffort: "low",
          } satisfies OpenAIResponsesProviderOptions,
        },
      });

      return { text };
    },
  });
  const completion = await copilot.complete({ body });

  return c.json(completion);
});

// ── POST /post_event ─────────────────────────────────────────────────

app.post(
  "/post_event",
  zValidator(
    "json",
    z.object({
      projectId: z.string(),
      event: studioClientEventSchema,
    }),
  ),
  async (c) => {
    const { event: eventWithoutEnvs, projectId } = await c.req.json();
    logger.info({ event: eventWithoutEnvs.type, projectId }, "post_event");

    const session = await getServerAuthSession({ req: c.req.raw as NextRequest });
    if (!session) {
      return c.json(
        { error: "You must be logged in to access this endpoint." },
        { status: 401 },
      );
    }

    const hasPermission = await hasProjectPermission(
      { prisma, session },
      projectId,
      "workflows:manage",
    );
    if (!hasPermission) {
      return c.json(
        { error: "You do not have permission to access this endpoint." },
        { status: 403 },
      );
    }

    let message: StudioClientEvent;
    try {
      message = await loadDatasets(
        await addEnvs(eventWithoutEnvs, projectId),
        projectId,
      );
    } catch (error) {
      logger.error({ error, projectId }, "error");
      captureException(error, { extra: { projectId } });
      return c.json({ error: (error as Error).message }, { status: 500 });
    }

    switch (message.type) {
      case "is_alive":
      case "stop_execution":
      case "execute_component":
      case "execute_flow":
      case "execute_evaluation":
      case "stop_evaluation_execution":
      case "execute_optimization":
      case "stop_optimization_execution":
        break;
      default:
        return c.json(
          //@ts-expect-error
          { error: `Unknown event type on server: ${message.type}` },
          { status: 400 },
        );
    }

    return streamSSE(c, async (stream) => {
      let resolved = false;
      const streamDone = new Promise<void>((resolve) => {
        const resolveOnce = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };

        void studioBackendPostEvent({
          projectId,
          message,
          onEvent: (serverEvent: StudioServerEvent) => {
            void stream.writeSSE({
              data: JSON.stringify(serverEvent),
            });

            if (serverEvent.type === "done") {
              setTimeout(() => {
                resolveOnce();
              }, 1000);
            }
          },
        })
          .catch((error: unknown) => {
            logger.error({ error }, "Error handling message");
            const errorMessage =
              error instanceof Error ? error.message : String(error);

            if ("node_id" in message.payload && message.payload.node_id) {
              void stream.writeSSE({
                data: JSON.stringify({
                  type: "component_state_change",
                  payload: {
                    component_id: message.payload.node_id,
                    execution_state: {
                      status: "error",
                      error: errorMessage,
                      timestamps: { finished_at: Date.now() },
                    },
                  },
                }),
              });
            } else {
              void stream.writeSSE({
                data: JSON.stringify({
                  type: "error",
                  payload: { message: errorMessage },
                }),
              });
            }
          })
          .finally(() => {
            resolveOnce();
          });
      });

      await streamDone;
    });
  },
);
