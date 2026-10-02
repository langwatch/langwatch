import {
  badRequestSchema,
  baseResponses,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";
/**
 * REST for the user events a trace carries. `POST /api/events/track` is
 * canonical; `POST /api/track_event` is the older name, forwarding rather
 * than redirecting (a 307 drops the body for some clients).
 */
import { resolveRequestBound } from "@langwatch/plans";
import {
  trackEventResponseSchema,
  trackEventRESTParamsValidatorSchema,
} from "@langwatch/trace-contract";
import { HTTPException } from "hono/http-exception";

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
  /** Parses, validates and dispatches one posted event; a bad body refuses with a 400. */
  trackEventFromRequest(input: {
    projectId: string;
    raw: string | Uint8Array | undefined;
  }): Promise<{ message: "Event tracked" }>;
}

export const TrackedEventApi = moduleApi<TrackedEventMembers>()("trace");

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
    operationId: "postApiEventsTrack",
    summary: "Record a user event",
    requestBody: { schema: trackEventRESTParamsValidatorSchema },
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
  .handle(({ app, raw, scope }) => app.trackEventFromRequest({ projectId: scope.id, raw }))

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
    operationId: "postApiTrackEvent",
    summary: "Track an event (legacy path)",
    description:
      "Record a customer event against a trace or thread. Identical to `POST /api/events/track`, " +
      "which is the path to use in new integrations; this one stays for callers written against it. " +
      "Supply `event_id` yourself to make the call idempotent.",
    tags: ["Events"],
    requestBody: { schema: trackEventRESTParamsValidatorSchema },
  })
  .handle(({ app, raw, scope }) => app.trackEventFromRequest({ projectId: scope.id, raw }))
  .build();
