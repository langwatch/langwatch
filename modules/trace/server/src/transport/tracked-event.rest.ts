/**
 * REST for the user events a trace carries. `POST /api/events/track` is the canonical
 * replacement for the legacy `POST /api/track_event`, which the mount forwards into this
 * route so the two URLs stay in lockstep. The recorder, predefined-payload check, error
 * sink and validation prose arrive as ports - neither belongs in a transport.
 */
import { createLogger } from "@langwatch/observability";
import {
  type TrackEventRESTParamsValidator,
  trackEventRESTParamsValidatorSchema,
} from "@langwatch/trace-contract";
import {
  badRequestSchema,
  baseResponses,
  BadRequestError,
  createFamilyErrorHandler,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/runtime-composition";
import { z } from "zod";

const logger = createLogger("langwatch:api:events");

const trackEventResponseSchema = z.object({
  message: z.literal("Event tracked"),
});

/**
 * A payload this family refused, carrying the prose the caller reads.
 *
 * The body has always been the bare `{ error }` the family writes itself, so
 * the refusal maps to `BadRequestError`, which renders the same flat shape.
 */
class TrackedEventRejectedError extends Error {}

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

export const TrackedEventApi = moduleApi<TrackedEventPorts>("trace");

export const trackedEventRest = defineRestRouter(TrackedEventApi)
  .withNamespace("events")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("projectKey")

  .post("/track", "trackEvent")
  .withRawBody("text", { mediaType: "application/json" })
  .withPermission("traces:create")
  .withOutput(trackEventResponseSchema)
  .withDocs({
    summary: "Record a user event",
    description:
      "Record a user event (e.g. thumbs up/down, selected text) attached to a trace. " +
      "Predefined event types validate against their schemas; custom event types pass " +
      "through `trackEventRESTParamsValidatorSchema`.",
    responses: {
      ...baseResponses,
      200: {
        description: "Event tracked",
        content: { "application/json": { schema: resolver(trackEventResponseSchema) } },
      },
      400: {
        description: "Invalid event payload",
        content: { "application/json": { schema: resolver(badRequestSchema) } },
      },
    },
  })
  .handle(async ({ app, raw, scope }) => {
    let rawBody: Record<string, unknown>;
    try {
      rawBody = JSON.parse(raw as string) as Record<string, unknown>;
    } catch {
      throw new TrackedEventRejectedError("Bad request");
    }

    let body: TrackEventRESTParamsValidator;
    try {
      body = trackEventRESTParamsValidatorSchema.parse(rawBody);
    } catch (error) {
      logger.error({ error, body: rawBody, projectId: scope.id }, "invalid event received");
      app.reportError(error);
      throw new TrackedEventRejectedError(app.describeValidationError(error));
    }

    try {
      app.assertPredefinedEventPayload(rawBody);
    } catch (error) {
      logger.error({ error, body: rawBody, projectId: scope.id }, "invalid event received");
      app.reportError(error);
      throw new TrackedEventRejectedError(app.describeValidationError(error));
    }

    const eventId = body.event_id ?? app.generateEventId();

    try {
      await app.recordTrackedEvent({ project: { id: scope.id }, body, eventId });
    } catch (error) {
      logger.error({ error }, "unable to dispatch tracked event span");
    }

    return { message: "Event tracked" as const };
  })

  .build();

export const trackedEventRestErrorHandler = (boundary: RestErrorHandler): RestErrorHandler =>
  createFamilyErrorHandler({
    boundary,
    loggerName: "langwatch:api:events:errors",
    label: "Tracked Event API Error",
    mapError: (error) => {
      if (error instanceof TrackedEventRejectedError) return new BadRequestError(error.message);
      return error;
    },
  });
