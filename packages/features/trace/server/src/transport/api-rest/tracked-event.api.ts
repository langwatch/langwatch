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
import type { ErrorHandler } from "hono";
import { z } from "zod";
import { requires } from "@langwatch/api";
import {
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  projectOf,
  type ProjectScopedContext,
  resolver,
} from "@langwatch/api/rest";

const logger = createLogger("langwatch:api:events");

const trackEventResponseSchema = z.object({
  message: z.literal("Event tracked"),
});

/**
 * A payload this family refused, carrying the prose the caller reads.
 *
 * The body has always been the bare `{ error }` the family writes itself, so
 * the refusal is raised as the family's own error and rendered by the family's
 * own handler rather than collapsing into the boundary's generic 500.
 */
class TrackedEventRejectedError extends Error {}

const trackedEventErrorHandler =
  (boundary: ErrorHandler): ErrorHandler =>
  (error, c) => {
    if (error instanceof TrackedEventRejectedError) {
      return c.json({ error: error.message }, 400);
    }
    return boundary(error, c);
  };

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
}): MountableRestApp {
  const { security, ports } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "events",
    basePath: "/api/events",
    errorEnvelope: "legacy",
    errorHandler: trackedEventErrorHandler,
  });

  type EventsContext = ProjectScopedContext<EndpointVariables>;

  // The body is read unparsed and parsed here rather than through `withInput`:
  // a rejection answers 400 with this family's own prose, which is what every
  // SDK release older than the canonical URL already reads.
  const trackHandler = async (c: EventsContext, input: { body: string }) => {
    const project = projectOf(c);

    let rawBody: Record<string, unknown>;
    try {
      rawBody = JSON.parse(input.body) as Record<string, unknown>;
    } catch {
      throw new TrackedEventRejectedError("Bad request");
    }

    let body: TrackEventRESTParamsValidator;
    try {
      body = trackEventRESTParamsValidatorSchema.parse(rawBody);
    } catch (error) {
      logger.error({ error, body: rawBody, projectId: project.id }, "invalid event received");
      ports.reportError(error);
      throw new TrackedEventRejectedError(ports.describeValidationError(error));
    }

    try {
      ports.assertPredefinedEventPayload(rawBody);
    } catch (error) {
      logger.error({ error, body: rawBody, projectId: project.id }, "invalid event received");
      ports.reportError(error);
      throw new TrackedEventRejectedError(ports.describeValidationError(error));
    }

    const eventId = body.event_id ?? ports.generateEventId();

    try {
      await ports.recordTrackedEvent({ project, body, eventId });
    } catch (error) {
      logger.error({ error }, "unable to dispatch tracked event span");
    }

    return { message: "Event tracked" as const };
  };

  return service
    .registerRoute("post", "/track", MANAGEMENT_API_VERSION, trackHandler, (b) =>
      policy(requires("traces:create"))(b)
        .withRawBody("text", { contentType: "application/json" })
        .withOutput(trackEventResponseSchema)
        .withDocs({
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
    )
    .build();
}
