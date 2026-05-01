import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { fromZodError, type ZodError } from "zod-validation-error";

import { badRequestSchema } from "~/app/api/shared/schemas";
import { prisma } from "~/server/db";
import { requirePatPermission } from "~/server/api/utils";
import {
  predefinedEventsSchemas,
  predefinedEventTypes,
  recordTrackedEventSpan,
  generateTrackedEventId,
} from "~/server/app-layer/events/track-event.service";
import { trackEventRESTParamsValidatorSchema } from "~/server/tracer/types.generated";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";

import {
  type AuthMiddlewareVariables,
  authMiddleware,
  handleError,
} from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { baseResponses } from "../../shared/base-responses";

patchZodOpenapi();

const logger = createLogger("langwatch:api:events");

type Variables = AuthMiddlewareVariables;

const requireTracesCreate = requirePatPermission({
  prisma,
  permission: "traces:create",
});

const trackEventResponseSchema = z.object({
  message: z.literal("Event tracked"),
});

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/events")
  .use(tracerMiddleware({ name: "events" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .onError(handleError)

  // ── Track Event ────────────────────────────────────────────
  // Canonical replacement for the legacy `POST /api/track_event`. The legacy
  // URL still works (handled by `src/server/routes/misc.ts`); both routes go
  // through `recordTrackedEventSpan` so behaviour stays in lockstep.
  .post(
    "/track",
    requireTracesCreate,
    describeRoute({
      description:
        "Record a user event (e.g. thumbs up/down, selected text) attached to a trace. " +
        "Predefined event types validate against their schemas; custom event types pass " +
        "through `trackEventRESTParamsValidatorSchema`.",
      responses: {
        ...baseResponses,
        200: {
          description: "Event tracked",
          content: {
            "application/json": { schema: resolver(trackEventResponseSchema) },
          },
        },
        400: {
          description: "Invalid event payload",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");

      let rawBody: Record<string, unknown>;
      try {
        rawBody = (await c.req.json()) as Record<string, unknown>;
      } catch {
        return c.json({ message: "Bad request" }, 400);
      }

      let body;
      try {
        body = trackEventRESTParamsValidatorSchema.parse(rawBody);
      } catch (error) {
        logger.error(
          { error, body: rawBody, projectId: project.id },
          "invalid event received",
        );
        captureException(error);
        const validationError = fromZodError(error as ZodError);
        return c.json({ error: validationError.message }, 400);
      }

      if (
        typeof rawBody.event_type === "string" &&
        predefinedEventTypes.includes(
          rawBody.event_type as (typeof predefinedEventTypes)[number],
        )
      ) {
        try {
          predefinedEventsSchemas.parse(rawBody);
        } catch (error) {
          logger.error(
            { error, body: rawBody, projectId: project.id },
            "invalid event received",
          );
          captureException(error);
          const validationError = fromZodError(error as ZodError);
          return c.json({ error: validationError.message }, 400);
        }
      }

      const eventId = body.event_id ?? generateTrackedEventId();

      try {
        await recordTrackedEventSpan({ project, body, eventId });
      } catch (error) {
        logger.error({ error }, "unable to dispatch tracked event span");
      }

      return c.json({ message: "Event tracked" as const });
    },
  );
