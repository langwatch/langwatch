import { defineCommand } from "../../commands/defineCommand";

import { activityEventReceivedDataSchema } from "./schemas/events";
import {
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_EVENT_VERSIONS,
} from "./schemas/constants";

/**
 * RecordActivityEventCommand — invoked by IngestionSource receivers
 * (/api/ingest/otel/:sourceId, /api/ingest/webhook/:sourceId) after
 * platform-specific normalisation. Each call appends one
 * ActivityEventReceived event to event_log; the activityEventStorage
 * map projection then writes the row to gateway_activity_events.
 *
 * aggregateType: "activity_event" — one event = one aggregate. There
 * is no fold across activity events into a parent aggregate (in
 * contrast to trace-processing where many spans fold into one trace).
 *
 * idempotencyKey uses (tenantId, eventId) so receiver retries don't
 * double-write.
 */
export const RecordActivityEventCommand = defineCommand({
  commandType: "lw.activity_event.record",
  eventType: ACTIVITY_EVENT_TYPES.RECEIVED,
  eventVersion: ACTIVITY_EVENT_VERSIONS.RECEIVED,
  aggregateType: "activity_event",
  schema: activityEventReceivedDataSchema,
  aggregateId: (d) => `${d.sourceId}:${d.eventId}`,
  idempotencyKey: (d) => `${d.tenantId}:${d.sourceId}:${d.eventId}`,
  spanAttributes: (d) => ({
    "payload.source.id": d.sourceId,
    "payload.source.type": d.sourceType,
    "payload.event.type": d.eventType,
    "payload.organization.id": d.organizationId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.sourceId}:${d.eventId}`,
});
