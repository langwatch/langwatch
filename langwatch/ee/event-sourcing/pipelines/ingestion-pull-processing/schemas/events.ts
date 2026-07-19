import { z } from "zod";

import { EventSchema } from "~/server/event-sourcing/domain/types";
import {
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSIONS,
} from "./constants";

const sourceEnvelope = z.object({ sourceId: z.string().min(1) });

export const ingestionPullConfiguredEventDataSchema = sourceEnvelope.extend({
  cron: z.string().min(1),
  configVersion: z.string().min(1),
  cursor: z.string().nullable(),
});
export type IngestionPullConfiguredEventData = z.infer<
  typeof ingestionPullConfiguredEventDataSchema
>;

export const ingestionPullDisabledEventDataSchema = sourceEnvelope.extend({
  configVersion: z.string().min(1),
});
export type IngestionPullDisabledEventData = z.infer<
  typeof ingestionPullDisabledEventDataSchema
>;

export const ingestionPullRunCompletedEventDataSchema = sourceEnvelope.extend({
  runId: z.string().min(1),
  scheduledFor: z.number(),
  nextCursor: z.string().nullable(),
  eventCount: z.number().int().nonnegative(),
});
export type IngestionPullRunCompletedEventData = z.infer<
  typeof ingestionPullRunCompletedEventDataSchema
>;

export const ingestionPullRunFailedEventDataSchema = sourceEnvelope.extend({
  runId: z.string().min(1),
  scheduledFor: z.number(),
  error: z.string(),
  errorCode: z.string(),
  retryable: z.boolean(),
});
export type IngestionPullRunFailedEventData = z.infer<
  typeof ingestionPullRunFailedEventDataSchema
>;

export const IngestionPullConfiguredEventSchema = EventSchema.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.CONFIGURED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.CONFIGURED),
  data: ingestionPullConfiguredEventDataSchema,
});
export const IngestionPullDisabledEventSchema = EventSchema.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.DISABLED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.DISABLED),
  data: ingestionPullDisabledEventDataSchema,
});
export const IngestionPullRunCompletedEventSchema = EventSchema.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.RUN_COMPLETED),
  data: ingestionPullRunCompletedEventDataSchema,
});
export const IngestionPullRunFailedEventSchema = EventSchema.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.RUN_FAILED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.RUN_FAILED),
  data: ingestionPullRunFailedEventDataSchema,
});

export type IngestionPullConfiguredEvent = z.infer<
  typeof IngestionPullConfiguredEventSchema
>;
export type IngestionPullDisabledEvent = z.infer<
  typeof IngestionPullDisabledEventSchema
>;
export type IngestionPullRunCompletedEvent = z.infer<
  typeof IngestionPullRunCompletedEventSchema
>;
export type IngestionPullRunFailedEvent = z.infer<
  typeof IngestionPullRunFailedEventSchema
>;
export type IngestionPullProcessingEvent =
  | IngestionPullConfiguredEvent
  | IngestionPullDisabledEvent
  | IngestionPullRunCompletedEvent
  | IngestionPullRunFailedEvent;
