import { z } from "zod";

import { governanceEventEnvelopeSchema } from "./governance.ts";

export const INGESTION_PULL_AGGREGATE_TYPE = "ingestion_pull" as const;
export const INGESTION_PULL_EVENT_TYPES = {
  CONFIGURED: "lw.obs.ingestion_pull.configured",
  DISABLED: "lw.obs.ingestion_pull.disabled",
  RUN_COMPLETED: "lw.obs.ingestion_pull.run_completed",
  RUN_FAILED: "lw.obs.ingestion_pull.run_failed",
  AGENTS_LISTING_REQUESTED: "lw.obs.ingestion_pull.agents_listing_requested",
  AGENTS_LISTED: "lw.obs.ingestion_pull.agents_listed",
  AGENTS_LISTING_REFUSED: "lw.obs.ingestion_pull.agents_listing_refused",
  PEOPLE_LISTING_REQUESTED: "lw.obs.ingestion_pull.people_listing_requested",
  PEOPLE_LISTED: "lw.obs.ingestion_pull.people_listed",
  PEOPLE_LISTING_REFUSED: "lw.obs.ingestion_pull.people_listing_refused",
} as const;
export const INGESTION_PULL_PROCESSING_EVENT_TYPES = Object.values(INGESTION_PULL_EVENT_TYPES);
export const INGESTION_PULL_EVENT_VERSIONS = {
  CONFIGURED: "2026-07-17",
  DISABLED: "2026-07-17",
  RUN_COMPLETED: "2026-07-17",
  RUN_FAILED: "2026-07-17",
  AGENTS_LISTING_REQUESTED: "2026-09-09",
  AGENTS_LISTED: "2026-09-09",
  AGENTS_LISTING_REFUSED: "2026-09-09",
  PEOPLE_LISTING_REQUESTED: "2026-09-09",
  PEOPLE_LISTED: "2026-09-09",
  PEOPLE_LISTING_REFUSED: "2026-09-09",
} as const;
/** Listing columns are nullable and new, so replay changes no row; see main's constants.ts. */
export const INGESTION_PULL_PROJECTION_VERSIONS = {
  RUN_STATUS: "2026-08-28",
} as const;
export const INGESTION_PULL_RUN_OUTCOME = {
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
export type IngestionPullRunOutcome =
  (typeof INGESTION_PULL_RUN_OUTCOME)[keyof typeof INGESTION_PULL_RUN_OUTCOME];

/** A listing's own vocabulary: an empty directory is LISTED with a zero count, never refused. */
export const INGESTION_PULL_LISTING_OUTCOME = {
  LISTED: "listed",
  REFUSED: "refused",
} as const;
export type IngestionPullListingOutcome =
  (typeof INGESTION_PULL_LISTING_OUTCOME)[keyof typeof INGESTION_PULL_LISTING_OUTCOME];

/** The refusal reason when our side gave out after retries, apart from any provider reason. */
export const LISTING_FAILED_REASON = "listing_failed";
/** The one failure code whose `error` is a sentence we wrote and the source page may show. */
export const PULL_REFUSED_ERROR_CODE = "pull_refused" as const;
/** Retries exhausted or a refusal without a customer sentence; `error` is log-only. */
export const PULL_FAILED_ERROR_CODE = "pull_failed" as const;

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
  const [minute = "", hour = "", day = "", month = "", weekday = ""] = cron.trim().split(/\s+/);
  const fieldsPresent = [minute, hour, day, month, weekday].every(Boolean);
  if (!fieldsPresent) return false;
  const fieldsInRange = [
    validCronField(minute, 0, 59),
    validCronField(hour, 0, 23),
    validCronField(day, 1, 31),
    validCronField(month, 1, 12),
    validCronField(weekday, 0, 7),
  ].every(Boolean);
  if (!fieldsInRange) return false;
  if (/^\d+$/.test(day) && /^\d+$/.test(month)) {
    const maximum = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1];
    if (maximum === undefined || Number(day) > maximum) return false;
  }
  return true;
}

export const pullScheduleSchema = z
  .string()
  .min(1)
  .superRefine((cron, ctx) => {
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
  return pullScheduleSchema.validate(cron);
}

const sourceEnvelopeSchema = z.object({ sourceId: z.string().min(1) }).strict();
export const ingestionPullConfiguredEventDataSchema = sourceEnvelopeSchema.safeExtend({
  cron: z.string().min(1),
  configVersion: z.string().min(1),
  cursor: z.string().nullable(),
});
export const ingestionPullConfiguredCommandDataSchema =
  ingestionPullConfiguredEventDataSchema.safeExtend({ cron: pullScheduleSchema });
export const ingestionPullDisabledEventDataSchema = sourceEnvelopeSchema.safeExtend({
  configVersion: z.string().min(1),
});
/** The optional fields are absent on history written before them; absent reads as unknown. */
export const ingestionPullRunCompletedEventDataSchema = sourceEnvelopeSchema.safeExtend({
  runId: z.string().min(1),
  scheduledFor: z.number(),
  nextCursor: z.string().nullable(),
  eventCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative().optional(),
  completeness: z.enum(["complete", "truncated"]).optional(),
  unreadPage: z.boolean().optional(),
  readThroughAt: z.number().nullable().optional(),
});
/** `retryAfterMs` is the wait a provider named; `replacedByRunId` is set on an abandonment only. */
export const ingestionPullRunFailedEventDataSchema = sourceEnvelopeSchema.safeExtend({
  runId: z.string().min(1),
  scheduledFor: z.number(),
  error: z.string(),
  errorCode: z.string(),
  retryable: z.boolean(),
  retryAfterMs: z.number().nullable().optional(),
  replacedByRunId: z.string().optional(),
});

/** One ask: a redelivery of one press carries the id it was minted with. */
const listingEnvelopeSchema = sourceEnvelopeSchema.safeExtend({ requestId: z.string().min(1) });
/** `reason` stays a plain string so a retired refusal reason still replays. */
const listingRefusalSchema = listingEnvelopeSchema.safeExtend({
  requestedAt: z.number(),
  reason: z.string().min(1),
  status: z.number().int().nullable(),
});
export const ingestionPullAgentsListingRequestedEventDataSchema = listingEnvelopeSchema;
export const ingestionPullAgentsListedEventDataSchema = listingEnvelopeSchema.safeExtend({
  requestedAt: z.number(),
  agentCount: z.number().int().nonnegative(),
});
export const ingestionPullAgentsListingRefusedEventDataSchema = listingRefusalSchema;
export const ingestionPullPeopleListingRequestedEventDataSchema = listingEnvelopeSchema;
/** `withheldPersonCount` is a subset of `directoryPersonCount` and never leaves our own stores. */
export const ingestionPullPeopleListedEventDataSchema = listingEnvelopeSchema.safeExtend({
  requestedAt: z.number(),
  directoryPersonCount: z.number().int().nonnegative(),
  withheldPersonCount: z.number().int().nonnegative(),
});
export const ingestionPullPeopleListingRefusedEventDataSchema = listingRefusalSchema;

const event = governanceEventEnvelopeSchema.safeExtend({
  aggregateType: z.literal(INGESTION_PULL_AGGREGATE_TYPE),
});
export const ingestionPullConfiguredEventSchema = event.safeExtend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.CONFIGURED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.CONFIGURED),
  data: ingestionPullConfiguredEventDataSchema,
});
export const ingestionPullDisabledEventSchema = event.safeExtend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.DISABLED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.DISABLED),
  data: ingestionPullDisabledEventDataSchema,
});
export const ingestionPullRunCompletedEventSchema = event.safeExtend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.RUN_COMPLETED),
  data: ingestionPullRunCompletedEventDataSchema,
});
export const ingestionPullRunFailedEventSchema = event.safeExtend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.RUN_FAILED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.RUN_FAILED),
  data: ingestionPullRunFailedEventDataSchema,
});

export const ingestionPullAgentsListingRequestedEventSchema = event.safeExtend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTING_REQUESTED),
  data: ingestionPullAgentsListingRequestedEventDataSchema,
});
export const ingestionPullAgentsListedEventSchema = event.safeExtend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTED),
  data: ingestionPullAgentsListedEventDataSchema,
});
export const ingestionPullAgentsListingRefusedEventSchema = event.safeExtend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REFUSED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTING_REFUSED),
  data: ingestionPullAgentsListingRefusedEventDataSchema,
});
export const ingestionPullPeopleListingRequestedEventSchema = event.safeExtend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REQUESTED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.PEOPLE_LISTING_REQUESTED),
  data: ingestionPullPeopleListingRequestedEventDataSchema,
});
export const ingestionPullPeopleListedEventSchema = event.safeExtend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.PEOPLE_LISTED),
  data: ingestionPullPeopleListedEventDataSchema,
});
export const ingestionPullPeopleListingRefusedEventSchema = event.safeExtend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REFUSED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.PEOPLE_LISTING_REFUSED),
  data: ingestionPullPeopleListingRefusedEventDataSchema,
});

export const ingestionPullProcessingEventSchema = z.discriminatedUnion("type", [
  ingestionPullConfiguredEventSchema,
  ingestionPullDisabledEventSchema,
  ingestionPullRunCompletedEventSchema,
  ingestionPullRunFailedEventSchema,
  ingestionPullAgentsListingRequestedEventSchema,
  ingestionPullAgentsListedEventSchema,
  ingestionPullAgentsListingRefusedEventSchema,
  ingestionPullPeopleListingRequestedEventSchema,
  ingestionPullPeopleListedEventSchema,
  ingestionPullPeopleListingRefusedEventSchema,
]);

export type IngestionPullConfiguredEventData = z.infer<
  typeof ingestionPullConfiguredEventDataSchema
>;
export type IngestionPullDisabledEventData = z.infer<typeof ingestionPullDisabledEventDataSchema>;
export type IngestionPullRunCompletedEventData = z.infer<
  typeof ingestionPullRunCompletedEventDataSchema
>;
export type IngestionPullRunFailedEventData = z.infer<typeof ingestionPullRunFailedEventDataSchema>;
export type IngestionPullAgentsListingRequestedEventData = z.infer<
  typeof ingestionPullAgentsListingRequestedEventDataSchema
>;
export type IngestionPullAgentsListedEventData = z.infer<
  typeof ingestionPullAgentsListedEventDataSchema
>;
export type IngestionPullAgentsListingRefusedEventData = z.infer<
  typeof ingestionPullAgentsListingRefusedEventDataSchema
>;
export type IngestionPullPeopleListingRequestedEventData = z.infer<
  typeof ingestionPullPeopleListingRequestedEventDataSchema
>;
export type IngestionPullPeopleListedEventData = z.infer<
  typeof ingestionPullPeopleListedEventDataSchema
>;
export type IngestionPullPeopleListingRefusedEventData = z.infer<
  typeof ingestionPullPeopleListingRefusedEventDataSchema
>;
export type IngestionPullProcessingEvent = z.infer<typeof ingestionPullProcessingEventSchema>;
export type IngestionPullProcessingEventType = IngestionPullProcessingEvent["type"];
