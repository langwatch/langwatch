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
import { streamSSE } from "hono/streaming";
import { CompletionCopilot } from "monacopilot";
import { z } from "zod";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import {
  type StudioClientEvent,
  type StudioServerEvent,
  studioClientEventSchema,
} from "~/optimization_studio/types/events";
import { hasProjectPermission } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { getServerAuthSession } from "~/server/auth";
import { DatasetNotReadyError } from "~/server/datasets/errors";
import { prisma } from "~/server/db";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { createLogger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { NextRequestShim as any } from "./types";

const logger = createLogger("langwatch:workflows");

const secured = createServiceApp({ basePath: "/api/workflows" });

// ── POST /code-completion ────────────────────────────────────────────

secured
  .access(
    handlerManagedAuth(
      "user session validated in-handler via getServerAuthSession",
    ),
  )
  .post("/code-completion", async (c) => {
    const body = await c.req.json();

    const session = await getServerAuthSession({ req: c.req.raw as any });
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

    try {
      const model = await getVercelAIModel({
        projectId,
        featureKey: "studio.autocomplete",
      });

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
    } catch (error) {
      logger.error(
        {
          err: error,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          projectId,
        },
        "code-completion failed",
      );
      captureException(toError(error), { extra: { projectId } });
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  });

// ── POST /post_event ─────────────────────────────────────────────────

secured
  .access(
    handlerManagedAuth(
      "user session validated in-handler via getServerAuthSession",
    ),
  )
  .post(
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

      const session = await getServerAuthSession({ req: c.req.raw as any });
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
        // I-READY: loading a dataset that's still preparing (s3_jsonl normalize in
        // flight) is a client-precondition failure, not a server fault — surface a
        // clean 425 (mirroring the dataset REST layer) and skip the Sentry capture
        // so an expected, transient state doesn't page anyone.
        if (error instanceof DatasetNotReadyError) {
          return c.json({ error: error.message }, { status: 425 });
        }
        logger.error({ error, projectId }, "error");
        captureException(toError(error), { extra: { projectId } });
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

      // Optimization is DSPy-only; the Go engine dropped it. Stop events
      // still pass so a previously-started run can be cancelled.
      if (message.type === "execute_optimization") {
        return c.json(
          {
            type: "optimize_disabled",
            message:
              "Optimization is no longer supported. The Optimize feature relied on DSPy, which has been removed.",
          },
          { status: 410 },
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

export const app = secured.hono;
