import { z } from "zod";
import { governanceEventEnvelopeSchema } from "./governance";

export const INGESTION_PULL_AGGREGATE_TYPE = "ingestion_pull" as const;
export const INGESTION_PULL_EVENT_TYPES = {
  CONFIGURED: "lw.obs.ingestion_pull.configured",
  DISABLED: "lw.obs.ingestion_pull.disabled",
  RUN_COMPLETED: "lw.obs.ingestion_pull.run_completed",
  RUN_FAILED: "lw.obs.ingestion_pull.run_failed",
} as const;
export const INGESTION_PULL_PROCESSING_EVENT_TYPES = Object.values(
  INGESTION_PULL_EVENT_TYPES,
);
export const INGESTION_PULL_EVENT_VERSIONS = {
  CONFIGURED: "2026-07-17",
  DISABLED: "2026-07-17",
  RUN_COMPLETED: "2026-07-17",
  RUN_FAILED: "2026-07-17",
} as const;
export const INGESTION_PULL_PROJECTION_VERSIONS = {
  RUN_STATUS: "2026-07-17",
} as const;
export const INGESTION_PULL_RUN_OUTCOME = {
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

function validCronField(field: string, min: number, max: number): boolean {
  return field.split(",").every((item) => {
    const match = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(item);
    if (!match) return false;
    const [, start, end, step] = match;
    if (step !== undefined && Number(step) < 1) return false;
    if (start === "*") return end === undefined;
    const first = Number(start);
    const last = end === undefined ? first : Number(end);
    return first >= min && first <= max && last >= first && last <= max;
  });
}

function isRunnableCron(cron: string): boolean {
  const [minute, hour, day, month, weekday] = cron.trim().split(/\s+/);
  if (!minute || !hour || !day || !month || !weekday) return false;
  if (
    !validCronField(minute, 0, 59) ||
    !validCronField(hour, 0, 23) ||
    !validCronField(day, 1, 31) ||
    !validCronField(month, 1, 12) ||
    !validCronField(weekday, 0, 7)
  ) return false;
  if (/^\d+$/.test(day) && /^\d+$/.test(month)) {
    const maximum = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1];
    if (maximum === undefined || Number(day) > maximum) return false;
  }
  return true;
}

export const pullScheduleSchema = z.string().min(1).superRefine((cron, ctx) => {
  if (cron.trim().split(/\s+/).length !== 5) {
    ctx.addIssue({
      code: "custom",
      message: "pull schedule must be a five-field cron expression",
    });
    return;
  }
  if (!isRunnableCron(cron)) {
    ctx.addIssue({
      code: "custom",
      message: "pull schedule is not a valid cron expression",
    });
  }
});

export function isValidPullSchedule(cron: string): boolean {
  return pullScheduleSchema.safeParse(cron).success;
}

const sourceEnvelopeSchema = z.object({ sourceId: z.string().min(1) }).strict();
export const ingestionPullConfiguredEventDataSchema = sourceEnvelopeSchema.extend({
  cron: z.string().min(1),
  configVersion: z.string().min(1),
  cursor: z.string().nullable(),
});
export const ingestionPullConfiguredCommandDataSchema =
  ingestionPullConfiguredEventDataSchema.extend({ cron: pullScheduleSchema });
export const ingestionPullDisabledEventDataSchema = sourceEnvelopeSchema.extend({
  configVersion: z.string().min(1),
});
export const ingestionPullRunCompletedEventDataSchema = sourceEnvelopeSchema.extend({
  runId: z.string().min(1),
  scheduledFor: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  eventCount: z.number().int().nonnegative(),
});
export const ingestionPullRunFailedEventDataSchema = sourceEnvelopeSchema.extend({
  runId: z.string().min(1),
  scheduledFor: z.number().int().nonnegative(),
  error: z.string(),
  errorCode: z.string().min(1),
  retryable: z.boolean(),
});

const event = governanceEventEnvelopeSchema.extend({
  aggregateType: z.literal(INGESTION_PULL_AGGREGATE_TYPE),
});
export const ingestionPullConfiguredEventSchema = event.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.CONFIGURED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.CONFIGURED),
  data: ingestionPullConfiguredEventDataSchema,
});
export const ingestionPullDisabledEventSchema = event.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.DISABLED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.DISABLED),
  data: ingestionPullDisabledEventDataSchema,
});
export const ingestionPullRunCompletedEventSchema = event.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.RUN_COMPLETED),
  data: ingestionPullRunCompletedEventDataSchema,
});
export const ingestionPullRunFailedEventSchema = event.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.RUN_FAILED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.RUN_FAILED),
  data: ingestionPullRunFailedEventDataSchema,
});

export const ingestionPullProcessingEventSchema = z.discriminatedUnion("type", [
  ingestionPullConfiguredEventSchema,
  ingestionPullDisabledEventSchema,
  ingestionPullRunCompletedEventSchema,
  ingestionPullRunFailedEventSchema,
]);

export type IngestionPullConfiguredEventData = z.infer<typeof ingestionPullConfiguredEventDataSchema>;
export type IngestionPullDisabledEventData = z.infer<typeof ingestionPullDisabledEventDataSchema>;
export type IngestionPullRunCompletedEventData = z.infer<typeof ingestionPullRunCompletedEventDataSchema>;
export type IngestionPullRunFailedEventData = z.infer<typeof ingestionPullRunFailedEventDataSchema>;
export type IngestionPullProcessingEvent = z.infer<typeof ingestionPullProcessingEventSchema>;
export type IngestionPullProcessingEventType = IngestionPullProcessingEvent["type"];
