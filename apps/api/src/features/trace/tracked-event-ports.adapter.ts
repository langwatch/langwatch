/**
 * What `POST /api/events/track` and `POST /api/track_event` need from this
 * process, bound to the span builder the trace package owns.
 *
 * The family itself — the routes, the two-pass validation, the response
 * bodies — lives in `@langwatch/trace-server`'s `tracked-event.api.ts`. What
 * lives here are the five ports that file declares, and each one is bound to
 * something this process ALREADY has rather than to a second copy of it:
 *
 *   - `recordTrackedEvent` reaches {@link TrackedEventSpanService}, whose span
 *     collection is the SAME dedup gate and the SAME `recordSpan` command the
 *     OTLP receiver and the SDK collector send on. A customer's thumbs-up and
 *     an SDK's `langwatch.event` therefore mint one span with one id, which is
 *     the whole reason the builder is a package's rather than a process's;
 *   - `generateEventId` is the builder's OWN static, not a second `generate()`
 *     call here. The `trackedevent` ksuid prefix is part of ids already in
 *     customers' databases, and a second spelling of it would put two shapes
 *     of id in one column;
 *   - `assertPredefinedEventPayload` is the second validation pass. The route
 *     has already parsed the body with the base schema when it calls this, so
 *     what is left is the per-type schema a predefined `event_type` must also
 *     satisfy. A custom event type has no such schema and is left alone;
 *   - `describeValidationError` renders the rejection the caller reads in the
 *     400 body. It names the offending field, because a tracked event that is
 *     refused without saying which metric was out of range is a call the
 *     customer cannot fix;
 *   - `reportError` is the process's error sink: a log line, which is where
 *     these errors were always meant to end up.
 */
import { zodErrorMessage } from "@langwatch/config";
import { ValidationError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import { predefinedEventsSchemas, predefinedEventTypes } from "@langwatch/trace-contract";
import type { TrackedEventPorts } from "@langwatch/trace-server";
import { TrackedEventSpanService } from "@langwatch/trace-server";
import { z } from "zod";

/** What binding the tracked-event family costs this process. */
export type ApiTrackedEventCollaborators = Readonly<{
  /** The harvested span builder, over this process's own span collection. */
  spans: TrackedEventSpanService;
  /** Where a rejected payload is reported. */
  logger: Pick<Logger, "error">;
}>;

/**
 * The tracked-event family's ports, over one process's span builder.
 *
 * A plain object rather than a class because {@link TrackedEventPorts} is an
 * interface the transport declares, not a port this process owns: there is no
 * second implementation to name and nothing here to subclass.
 */
export function createApiTrackedEventPorts(
  collaborators: ApiTrackedEventCollaborators,
): TrackedEventPorts {
  const { spans, logger } = collaborators;

  return {
    assertPredefinedEventPayload(rawBody: Record<string, unknown>): void {
      const eventType = rawBody.event_type;
      // The base schema has already run and requires a string here; anything
      // else never reaches this call, and if it did it is the base schema's
      // rejection to make rather than this one's.
      if (typeof eventType !== "string") return;
      // `some` rather than `includes`, which would need the caller's arbitrary
      // string cast to the tuple's own union before it type-checks — a cast
      // that asserts exactly the thing being asked.
      if (!predefinedEventTypes.some((predefined) => predefined === eventType)) return;

      const result = predefinedEventsSchemas.safeParse(rawBody);
      if (result.success) return;

      // Handled, because we know the cause and the caller can act on it: the
      // message names the field. The subclass's own 422 never reaches the
      // caller — the route catches this and answers the 400 the endpoint has
      // always answered a malformed event with, which is what a deployed
      // client reads.
      throw new ValidationError(zodErrorMessage(result.error));
    },

    generateEventId: () => TrackedEventSpanService.generateEventId(),

    recordTrackedEvent: ({ project, body, eventId }) =>
      spans.record({ tenantId: project.id, body, eventId }),

    reportError: (error: unknown): void => {
      logger.error({ error }, "a tracked event was rejected before it could be recorded");
    },

    describeValidationError: (error: unknown): string => describeValidationError(error),
  };
}

/**
 * The sentence in the 400 body.
 *
 * Two shapes reach here and both name a field: the base schema's own
 * `ZodError`, which the route hands over untouched, and the
 * {@link ValidationError} the predefined pass above raises. Anything else is a
 * failure we did not anticipate, and it gets the one generic sentence rather
 * than whatever prose the throw happened to carry — a validation body is
 * returned to an unauthenticated-at-the-edge caller, and an internal message
 * rendered there is a leak.
 */
function describeValidationError(error: unknown): string {
  if (error instanceof ValidationError) return error.message;
  if (error instanceof z.ZodError) return zodErrorMessage(error);
  return "The tracked event payload could not be validated.";
}
