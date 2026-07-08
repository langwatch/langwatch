import { defineCommand } from "../../../commands/defineCommand";
import {
  PIN_TRACE_COMMAND_TYPE,
  TRACE_PINNED_EVENT_TYPE,
  TRACE_PINNED_EVENT_VERSION_LATEST,
  UNPIN_TRACE_COMMAND_TYPE,
  TRACE_UNPINNED_EVENT_TYPE,
  TRACE_UNPINNED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import {
  tracePinnedEventDataSchema,
  traceUnpinnedEventDataSchema,
} from "../schemas/events";

/**
 * Pins a trace. Provenance lives in `source`: a `manual` pin (user action)
 * overrides any existing pin, while a `share` auto-pin only takes effect when
 * the trace is not already pinned — the fold projection runs that state
 * machine.
 *
 * Idempotency keys off `occurredAt`, not just the source: the fold reads its
 * event stream through `deduplicateEvents`, which drops later events sharing an
 * idempotencyKey. A stable key would make a pin→unpin→pin toggle collapse (the
 * re-pin deduped against the first pin), leaving the trace wrongly unpinned.
 * Including the action timestamp keeps every distinct user action in the stream
 * while queue-level retries (same occurredAt) still collapse.
 */
export const PinTraceCommand = defineCommand({
  commandType: PIN_TRACE_COMMAND_TYPE,
  eventType: TRACE_PINNED_EVENT_TYPE,
  eventVersion: TRACE_PINNED_EVENT_VERSION_LATEST,
  aggregateType: "trace",
  schema: tracePinnedEventDataSchema,
  aggregateId: (d) => d.traceId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.traceId}:pin_trace:${d.source}:${d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.trace.id": d.traceId,
    "payload.pin.source": d.source,
    "payload.pinned_by_user_id": d.pinnedByUserId ?? "",
  }),
  // Include `source` so a concurrent manual pin and share auto-pin on the same
  // trace in the same millisecond get distinct jobs instead of one being
  // dropped at the queue; retries of the same action still collapse.
  makeJobId: (d) =>
    `${d.tenantId}:${d.traceId}:pin_trace:${d.source}:${d.occurredAt}`,
});

/**
 * Unpins a trace. `source` is who is unpinning: `manual` (user action) clears
 * the pin unconditionally; `share` (from unshare) only clears a still-
 * `share`-sourced pin, so a user's manual pin survives. The active-share guard
 * for a manual unpin is enforced in the app-layer service before dispatch.
 */
export const UnpinTraceCommand = defineCommand({
  commandType: UNPIN_TRACE_COMMAND_TYPE,
  eventType: TRACE_UNPINNED_EVENT_TYPE,
  eventVersion: TRACE_UNPINNED_EVENT_VERSION_LATEST,
  aggregateType: "trace",
  schema: traceUnpinnedEventDataSchema,
  aggregateId: (d) => d.traceId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.traceId}:unpin_trace:${d.source}:${d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.trace.id": d.traceId,
    "payload.unpin.source": d.source,
  }),
  makeJobId: (d) =>
    `${d.tenantId}:${d.traceId}:unpin_trace:${d.source}:${d.occurredAt}`,
});
