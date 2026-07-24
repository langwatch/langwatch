import { defineCommand } from "../../../commands/defineCommand";
import {
  CHANGE_TRACE_NAME_COMMAND_TYPE,
  TRACE_NAME_CHANGED_EVENT_TYPE,
  TRACE_NAME_CHANGED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import { traceNameChangedEventDataSchema } from "../schemas/events";

/**
 * Persists a user-driven trace rename.
 *
 * Idempotency keys off the new name itself — duplicate submissions of
 * the same value collapse, while genuinely changing the name a second
 * time produces a fresh event. The aggregate is the trace, so the fold
 * projection's `traceNameUserOverridden` latch keeps the rename
 * resilient against later root-span arrivals overwriting the user's
 * edit.
 */
export const ChangeTraceNameCommand = defineCommand({
  commandType: CHANGE_TRACE_NAME_COMMAND_TYPE,
  eventType: TRACE_NAME_CHANGED_EVENT_TYPE,
  eventVersion: TRACE_NAME_CHANGED_EVENT_VERSION_LATEST,
  aggregateType: "trace",
  schema: traceNameChangedEventDataSchema,
  aggregateId: (d) => d.traceId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.traceId}:change_trace_name:${d.newName}`,
  spanAttributes: (d) => ({
    "payload.trace.id": d.traceId,
    "payload.new_name.length": d.newName.length,
    "payload.changed_by_user_id": d.changedByUserId ?? "",
  }),
  makeJobId: (d) => `${d.tenantId}:${d.traceId}:change_trace_name`,
});
