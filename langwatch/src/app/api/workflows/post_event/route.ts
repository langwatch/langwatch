import { Hono } from "hono";
import { handle } from "hono/vercel";
import { loadDatasets } from "../../../../optimization_studio/server/loadDatasets";
import { addEnvs } from "../../../../optimization_studio/server/addEnvs";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../../../../server/db";
import { backendHasTeamProjectPermission } from "../../../../server/api/permission";
import { authOptions } from "../../../../server/auth";
import { getServerSession } from "next-auth";
import { studioBackendPostEvent } from "../../../../optimization_studio/server/socketServer";
import { streamSSE } from "hono/streaming";
import {
  studioClientEventSchema,
  type StudioClientEvent,
  type StudioServerEvent,
} from "../../../../optimization_studio/types/events";
import { createLogger } from "../../../../utils/logger.server";
import type { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";

const logger = createLogger("langwatch:post_message");

const app = new Hono().basePath("/api/workflows");

app.post(
  "/post_event",
  zValidator(
    "json",
    z.object({
      projectId: z.string(),
      event: studioClientEventSchema,
    })
  ),
  async (c) => {
    const { event: eventWithoutEnvs, projectId } = await c.req.json();
    logger.info("post_event", {
      event: eventWithoutEnvs.type,
      projectId,
    });

    const session = await getServerSession(
      authOptions(c.req.raw as NextRequest)
    );
    if (!session) {
      return c.json(
        { error: "You must be logged in to access this endpoint." },
        { status: 401 }
      );
    }

    const hasPermission = await backendHasTeamProjectPermission(
      { prisma, session },
      { projectId },
      "WORKFLOWS_MANAGE"
    );
    if (!hasPermission) {
      return c.json(
        { error: "You do not have permission to access this endpoint." },
        { status: 403 }
      );
    }

    let message: StudioClientEvent;
    try {
      message = await loadDatasets(
        await addEnvs(eventWithoutEnvs, projectId),
        projectId
      );
    } catch (error) {
      logger.error("error", {
        error,
        projectId,
      });
      Sentry.captureException(error, {
        extra: {
          projectId,
        },
      });
      return c.json(
        { error: (error as Error).message },
        { status: 500 }
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
          logger.error("error", error);
          Sentry.captureException(error, {
            extra: {
              projectId,
              message,
            },
          });
          void stream.writeSSE({
            data: JSON.stringify({
              type: "error",
              payload: { message: error.message },
            }),
          });
        });
      });

      // Wait for the stream to be done
      await streamDone;
    });
  }
);

export const GET = handle(app);
export const POST = handle(app);
