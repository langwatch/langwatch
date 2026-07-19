import { z } from "zod";

import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import { EventSchema } from "~/server/event-sourcing/domain/types";
import {
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSIONS,
} from "./constants";

const sourceEnvelope = z.object({ sourceId: z.string().min(1) });

/**
 * Write-side schedule guard. The command boundary is where an invalid cron
 * must be rejected: once committed, the event replays through the process
 * subscriber forever, so evolve can only degrade, not refuse.
 */
export const pullScheduleSchema = z
  .string()
  .min(1)
  .superRefine((cron, ctx) => {
    if (cron.trim().split(/\s+/).length !== 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pull schedule must be a five-field cron expression",
      });
      return;
    }
    try {
      computeNextRunAt({ cron, timezone: "UTC", after: new Date() });
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pull schedule is not a valid cron expression",
      });
    }
  });

export const ingestionPullConfiguredEventDataSchema = sourceEnvelope.extend({
  // Deliberately permissive on the read path: a cron that slipped into the
  // log before write-side validation existed must still parse so replays
  // and projections cannot be poisoned by it.
  cron: z.string().min(1),
  configVersion: z.string().min(1),
  cursor: z.string().nullable(),
});
export type IngestionPullConfiguredEventData = z.infer<
  typeof ingestionPullConfiguredEventDataSchema
>;

/** Command-boundary variant of the configured data: schedule must be valid. */
export const ingestionPullConfiguredCommandDataSchema =
  ingestionPullConfiguredEventDataSchema.extend({
    cron: pullScheduleSchema,
  });

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
