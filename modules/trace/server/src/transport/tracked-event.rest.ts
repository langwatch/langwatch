/**
 * REST for the user events a trace carries. `POST /api/events/track` is
 * canonical; `POST /api/track_event` is the older name, forwarding rather
 * than redirecting (a 307 drops the body for some clients).
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
import { publicRoute } from "@langwatch/api/access";
import { moduleApi } from "@langwatch/runtime-composition";
import { resolveRequestBound } from "@langwatch/plans";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

const logger = createLogger("langwatch:api:events");

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

/** Telemetry posts; the bulk cap is the ceiling a misbehaving SDK can hit. */
const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");

const trackEventResponseSchema = z.object({
  message: z.literal("Event tracked"),
});

/**
 * A payload this family refused, carrying the prose the caller reads. The
 * body has always been the bare `{ error }` this family writes, so the
 * refusal maps to `BadRequestError`, which renders the same flat shape.
 */
class TrackedEventRejectedError extends Error {}

/**
 * What recording a tracked event needs from the process. Method syntax
 * throughout, so a host may name its own concrete session, project and
 * error types rather than restating the widened ones here.
 */
export interface TrackedEventMembers {
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

export const TrackedEventApi = moduleApi<TrackedEventMembers>("trace");

/** The URL every pre-rename SDK release posts a tracked event to. */
export const TRACKED_EVENT_LEGACY_PATH = "/api/track_event";
/** The URL this family actually registers. */
export const TRACKED_EVENT_CANONICAL_PATH = "/api/events/track";

export const trackedEventRest = defineRestRouter(TrackedEventApi)
  .withNamespace("events")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")

  .post("/track", "trackEvent")
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
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

/** The `/api/track_event` alias: the one thing it does is forward. */
export interface TrackedEventLegacyPathApi {
  forward(request: Request): Promise<Response>;
}

export const TrackedEventLegacyPathApi = moduleApi<TrackedEventLegacyPathApi>("trace");

/**
 * `POST /api/track_event` - the family's older name, re-dispatched. TERMINATES
 * NOTHING: the canonical route authenticates the forwarded request exactly as
 * a direct one.
 */
export const trackedEventLegacyPathRest = defineRestRouter(TrackedEventLegacyPathApi)
  .withNamespace("track-event-legacy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .post(TRACKED_EVENT_LEGACY_PATH, "trackEventLegacyAlias")
  .withAccess(
    publicRoute({
      reason:
        "the alias forwards the request into the canonical route, which authenticates it " +
        "exactly as it would a direct call",
    }),
  )
  .withRawResponse({ produces: "application/json" })
  .withDocs({ hide: true })
  .handle(({ app, request }): Promise<Response> => {
    const url = new URL(request.url);
    url.pathname = TRACKED_EVENT_CANONICAL_PATH;
    return app.forward(new Request(url.toString(), request));
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
