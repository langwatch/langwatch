import { defineCommand } from "../../../commands/defineCommand";
import {
  CHANGE_TRACE_METADATA_COMMAND_TYPE,
  TRACE_METADATA_CHANGED_EVENT_TYPE,
  TRACE_METADATA_CHANGED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import { traceMetadataChangedEventDataSchema } from "../schemas/events";

export const ChangeTraceMetadataCommand = defineCommand({
  commandType: CHANGE_TRACE_METADATA_COMMAND_TYPE,
  eventType: TRACE_METADATA_CHANGED_EVENT_TYPE,
  eventVersion: TRACE_METADATA_CHANGED_EVENT_VERSION_LATEST,
  aggregateType: "trace",
  schema: traceMetadataChangedEventDataSchema,
  aggregateId: (d) => d.traceId,
  idempotencyKey: (d) =>
    `${d.tenantId}:${d.traceId}:change_trace_metadata:${JSON.stringify(d.metadata)}`,
  spanAttributes: (d) => ({
    "payload.trace.id": d.traceId,
    "payload.metadata.key_count": Object.keys(d.metadata).length,
    "payload.changed_by_user_id": d.changedByUserId ?? "",
  }),
});
