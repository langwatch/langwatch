import { z } from "zod";

import { EventSchema } from "../../../domain/types";
import {
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_EVENT_VERSIONS,
} from "./constants";

/**
 * Event metadata for activity-monitor events.
 */
const activityEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * ActivityEventReceived — emitted by the receivers
 * (POST /api/ingest/otel/:sourceId, /api/ingest/webhook/:sourceId)
 * after platform-specific normalisation. Each event represents one
 * fully-normalised OCSF + AOS observation: a span, an audit-log
 * entry, a webhook event. The data shape mirrors the
 * `gateway_activity_events` ClickHouse columns the
 * activityEventStorage map projection writes.
 */
export const activityEventReceivedDataSchema = z.object({
  /** IngestionSource.id — also the ClickHouse TenantId. */
  sourceId: z.string(),
  /** Org id — denormalised for cross-source admin queries. */
  organizationId: z.string(),
  /** Platform identifier (otel_generic / claude_cowork / etc). */
  sourceType: z.string(),
  /** OCSF event taxonomy (api.call / tool.invocation / agent.action / etc). */
  eventType: z.string(),
  /** Stable id for dedup under ReplacingMergeTree (CH). */
  eventId: z.string(),
  /** Actor — user email / principal id / agent session id. */
  actor: z.string().default(""),
  /** Action verb in this domain. */
  action: z.string().default(""),
  /** Target — model / tool / resource. */
  target: z.string().default(""),
  /** Optional cost in USD as decimal-string for precision. */
  costUsd: z.string().optional(),
  tokensInput: z.number().int().nonnegative().default(0),
  tokensOutput: z.number().int().nonnegative().default(0),
  /** Forensic copy of the upstream payload (truncated by writer). */
  rawPayload: z.string().default(""),
  /** Wall-clock event time per the upstream platform (ms epoch). */
  eventTimestampMs: z.number().int().nonnegative(),
});

export const activityEventReceivedEventSchema = EventSchema.extend({
  type: z.literal(ACTIVITY_EVENT_TYPES.RECEIVED),
  data: activityEventReceivedDataSchema,
  metadata: activityEventMetadataSchema.optional(),
});

export type ActivityEventReceivedData = z.infer<
  typeof activityEventReceivedDataSchema
>;
export type ActivityEventReceivedEvent = z.infer<
  typeof activityEventReceivedEventSchema
>;

/**
 * Union of all activity-monitor-processing events. Today there's only
 * one — additional event types (e.g. `lw.activity_event.dispatched`)
 * land in follow-up slices as the dispatch pattern matures.
 */
export type ActivityMonitorProcessingEvent = ActivityEventReceivedEvent;

export const ACTIVITY_EVENT_VERSION_RECEIVED =
  ACTIVITY_EVENT_VERSIONS.RECEIVED;
