import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { handle } from "hono/vercel";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { captureException } from "~/utils/posthogErrorCapture";
import { addEnvs } from "../../../../optimization_studio/server/addEnvs";
import { loadDatasets } from "../../../../optimization_studio/server/loadDatasets";
import {
  type StudioClientEvent,
  type StudioServerEvent,
  studioClientEventSchema,
} from "../../../../optimization_studio/types/events";
import { hasProjectPermission } from "../../../../server/api/rbac";
import { authOptions } from "../../../../server/auth";
import { prisma } from "../../../../server/db";
import { createLogger } from "../../../../utils/logger";
import { loggerMiddleware } from "../../middleware/logger";
import { studioBackendPostEvent } from "./post-event";

const logger = createLogger("langwatch:post_message");

const app = new Hono().basePath("/api/workflows");
app.use(loggerMiddleware());

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

    const session = await getServerSession(
      authOptions(c.req.raw as NextRequest),
    );
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
      captureException(error, {
        extra: {
          projectId,
        },
      });
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

    // Use streamSSE to create an SSE stream response
    return streamSSE(c, async (stream) => {
      // Create a promise that will resolve when the stream should end
      const streamDone = new Promise<void>((resolve) => {
        void studioBackendPostEvent({
          projectId,
          message,
          onEvent: (serverEvent: StudioServerEvent) => {
            // Write each event to the SSE stream
            void stream.writeSSE({
              data: JSON.stringify(serverEvent),
            });

            // If we receive a "done" event, resolve the promise to end the stream
            if (serverEvent.type === "done") {
              setTimeout(() => {
                resolve();
              }, 1000);
            }
          },
        }).catch((error) => {
          logger.error({ error }, "Error handling message");

          // handle component error
          if ("node_id" in message.payload && message.payload.node_id) {
            void stream.writeSSE({
              data: JSON.stringify({
                type: "component_state_change",
                payload: {
                  component_id: message.payload.node_id,
                  execution_state: {
                    status: "error",
                    error: error.message,
                    timestamps: { finished_at: Date.now() },
                  },
                },
              }),
            });
          } else {
            void stream.writeSSE({
              data: JSON.stringify({
                type: "error",
                payload: { message: error.message },
              }),
            });
          }
        });
      });

      // Wait for the stream to be done
      await streamDone;
    });
  },
);

export const GET = handle(app);
export const POST = handle(app);
