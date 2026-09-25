import {
  badRequestSchema,
  baseResponses,
  BadRequestError,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";
/**
 * REST for the user events a trace carries. `POST /api/events/track` is
 * canonical; `POST /api/track_event` is the older name, forwarding rather
 * than redirecting (a 307 drops the body for some clients).
 */
import { createLogger } from "@langwatch/observability";
import { resolveRequestBound } from "@langwatch/plans";
import {
  type TrackEventRESTParamsValidator,
  trackEventResponseSchema,
  trackEventRESTParamsValidatorSchema,
} from "@langwatch/trace-contract";
import { HTTPException } from "hono/http-exception";

const logger = createLogger("langwatch:api:events");

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

/** Telemetry posts; the bulk cap is the ceiling a misbehaving SDK can hit. */
const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");

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

export const TrackedEventApi = moduleApi<TrackedEventMembers>()("trace");

/** The URL every pre-rename SDK release posts a tracked event to. */
export const TRACKED_EVENT_LEGACY_PATH = "/api/track_event";
/** The URL this family actually registers. */
export const TRACKED_EVENT_CANONICAL_PATH = "/api/events/track";

/**
 * What both addresses do. One body behind two routes, the way the monolith
 * shared a service between `/api/track_event` and the canonical route, so the
 * older name cannot drift from the newer one.
 */
async function recordTrackedEvent({
  app,
  raw,
  scope,
}: {
  app: TrackedEventMembers;
  raw: string | Uint8Array | undefined;
  scope: Readonly<{ id: string }>;
}): Promise<{ message: "Event tracked" }> {
  let rawBody: Record<string, unknown>;
  try {
    rawBody = JSON.parse(raw as string) as Record<string, unknown>;
  } catch {
    throw new BadRequestError("Bad request");
  }

  let body: TrackEventRESTParamsValidator;
  try {
    body = trackEventRESTParamsValidatorSchema.parse(rawBody);
  } catch (error) {
    logger.error({ error, body: rawBody, projectId: scope.id }, "invalid event received");
    app.reportError(error);
    throw new BadRequestError(app.describeValidationError(error));
  }

  try {
    app.assertPredefinedEventPayload(rawBody);
  } catch (error) {
    logger.error({ error, body: rawBody, projectId: scope.id }, "invalid event received");
    app.reportError(error);
    throw new BadRequestError(app.describeValidationError(error));
  }

  const eventId = body.event_id ?? app.generateEventId();

  try {
    await app.recordTrackedEvent({ project: { id: scope.id }, body, eventId });
  } catch (error) {
    logger.error({ error }, "unable to dispatch tracked event span");
  }

  return { message: "Event tracked" as const };
}

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
  .handle(recordTrackedEvent)

  .build();

/**
 * `POST /api/track_event` - the older name, over the same body. It reads the
 * same credential and asks the same permission, so re-dispatching into the
 * canonical route would only buy a second trip through the runtime.
 */
export const trackedEventLegacyPathRest = defineRestRouter(TrackedEventApi)
  .withNamespace("track-event-legacy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("project")
  .post(TRACKED_EVENT_LEGACY_PATH, "trackEventLegacyAlias")
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withPermission("traces:create")
  .withOutput(trackEventResponseSchema)
  .withDocs({
    summary: "Track an event (legacy path)",
    description:
      "Record a customer event against a trace or thread. Identical to `POST /api/events/track`, " +
      "which is the path to use in new integrations; this one stays for callers written against it. " +
      "Supply `event_id` yourself to make the call idempotent.",
    tags: ["Events"],
    requestBody: { schema: trackEventRESTParamsValidatorSchema },
  })
  .handle(recordTrackedEvent)
  .build();
