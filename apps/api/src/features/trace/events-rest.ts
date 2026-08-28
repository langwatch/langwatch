/**
 * REST for the user events a trace carries — a thumbs up, a selected span, a
 * custom metric a customer records against a run.
 *
 * `POST /api/events/track` is the canonical replacement for the legacy
 * `POST /api/track_event`. The legacy URL still works and is served by the
 * application's own misc routes; both go through the same recorder port, so
 * the two URLs stay in lockstep.
 *
 * The recorder, the predefined-payload check, the error sink and the
 * validation prose arrive as ports: dispatching the event's span reaches the
 * trace-processing pipeline, and rendering a rejection reaches the
 * application's own error vocabulary. Neither belongs in a transport.
 */
import { createLogger } from "@langwatch/observability";
import {
  type TrackEventRESTParamsValidator,
  trackEventRESTParamsValidatorSchema,
} from "@langwatch/trace-contract";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  patchZodOpenapi,
  requires,
  type SecuredApp,
} from "../../app-rest";

patchZodOpenapi();

const logger = createLogger("langwatch:api:events");

const trackEventResponseSchema = z.object({
  message: z.literal("Event tracked"),
});

/**
 * What recording a tracked event needs from the process.
 *
 * Method syntax throughout, so a host implementation may name its own concrete
 * session, project and error types rather than restating the widened ones here.
 */
export interface TrackedEventPorts {
  /**
   * Refuses a payload whose `event_type` is one of the predefined kinds but
   * whose body does not match that kind's schema. Throws; a payload naming a
   * custom event type is left alone.
   */
  assertPredefinedEventPayload(rawBody: Record<string, unknown>): void;
  /** A fresh tracked-event id, for a caller that did not send one. */
  generateEventId(): string;
  /** Dispatches the event's span through the trace-processing pipeline. */
  recordTrackedEvent(
    input: Readonly<{
      project: Readonly<{ id: string }>;
      body: TrackEventRESTParamsValidator;
      eventId: string;
    }>,
  ): Promise<void>;
  /** Reports a rejected payload to the application's error sink. */
  reportError(error: unknown): void;
  /** A readable message for a validation failure, in the caller's 400 body. */
  describeValidationError(error: unknown): string;
}

/**
 * REST for tracked events, built against one process's security and recorder.
 */
export function createEventsRestApp(options: {
  security: AppRestSecurity;
  ports: TrackedEventPorts;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, ports } = options;

  const secured = security.createProjectApp({ basePath: "/api/events" });

  secured.access(requires("traces:create")).post(
    "/track",
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
        return c.json({ error: "Bad request" }, 400);
      }

      let body: TrackEventRESTParamsValidator;
      try {
        body = trackEventRESTParamsValidatorSchema.parse(rawBody);
      } catch (error) {
        logger.error({ error, body: rawBody, projectId: project.id }, "invalid event received");
        ports.reportError(error);
        return c.json({ error: ports.describeValidationError(error) }, 400);
      }

      try {
        ports.assertPredefinedEventPayload(rawBody);
      } catch (error) {
        logger.error({ error, body: rawBody, projectId: project.id }, "invalid event received");
        ports.reportError(error);
        return c.json({ error: ports.describeValidationError(error) }, 400);
      }

      const eventId = body.event_id ?? ports.generateEventId();

      try {
        await ports.recordTrackedEvent({ project, body, eventId });
      } catch (error) {
        logger.error({ error }, "unable to dispatch tracked event span");
      }

      return c.json({ message: "Event tracked" as const });
    },
  );

  return secured;
}
