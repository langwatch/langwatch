import { z } from "zod";

import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";

/**
 * `prefix` keeps every derived type string byte-equal to the dotted forms
 * already in `event_log` (`lw.obs.ingestion_pull.run_completed`), and the name
 * is the aggregate type — one ordered stream per ingestion source.
 */
export const INGESTION_PULL_PIPELINE_NAME = "ingestion_pull";
export const INGESTION_PULL_PIPELINE_PREFIX = "lw.obs";

// `apply(state, data)` sees no envelope, so every payload a handler derives a
// time from states `occurredAt` itself.
const sourceEnvelope = z.object({
  sourceId: z.string().min(1),
  occurredAt: z.number(),
});

/**
 * Write-side schedule guard. The command boundary is where an invalid cron
 * must be rejected: once committed, the event replays through the process
 * manager forever, so evolve can only degrade, not refuse.
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

/**
 * The imperative face of pullScheduleSchema — one validator, two shapes.
 *
 * There is no `assert` variant here. The one that existed threw the zod
 * issues away and rethrew a plain `Error`, so an admin's cron typo arrived as
 * an unnamed 500; its only caller now raises a `ValidationError` that keeps
 * the issues (`ingestionSource.service.ts::assertPullSchedule`). The process
 * manager reads the boolean, because a cron already committed to the log has
 * to be skipped, not thrown over.
 */
export function isValidPullSchedule(cron: string): boolean {
  return pullScheduleSchema.safeParse(cron).success;
}

const ingestionPullConfiguredDataSchema = sourceEnvelope.extend({
  // Deliberately permissive on the read path: a cron that slipped into the
  // log before write-side validation existed must still parse so replays
  // and projections cannot be poisoned by it.
  cron: z.string().min(1),
  configVersion: z.string().min(1),
  cursor: z.string().nullable(),
});

/** Command-boundary variant of the configured data: schedule must be valid. */
export const ingestionPullConfiguredCommandDataSchema =
  ingestionPullConfiguredDataSchema.extend({ cron: pullScheduleSchema });

export const ingestionPullDisabledDataSchema = sourceEnvelope.extend({
  configVersion: z.string().min(1),
});

export const ingestionPullRunCompletedDataSchema = sourceEnvelope.extend({
  runId: z.string().min(1),
  scheduledFor: z.number(),
  nextCursor: z.string().nullable(),
  eventCount: z.number().int().nonnegative(),
});

export const ingestionPullRunFailedDataSchema = sourceEnvelope.extend({
  runId: z.string().min(1),
  scheduledFor: z.number(),
  error: z.string(),
  errorCode: z.string(),
  retryable: z.boolean(),
});

/** The pull lifecycle's whole vocabulary; state belongs to the fold and the
 * process manager that accumulate it, not to this map. */
export const ingestionPullEvents = {
  configured: ingestionPullConfiguredDataSchema,
  disabled: ingestionPullDisabledDataSchema,
  runCompleted: ingestionPullRunCompletedDataSchema,
  runFailed: ingestionPullRunFailedDataSchema,
} as const;

export type IngestionPullConfiguredData = z.infer<
  typeof ingestionPullConfiguredCommandDataSchema
>;
export type IngestionPullDisabledData = z.infer<
  typeof ingestionPullDisabledDataSchema
>;
export type IngestionPullRunCompletedData = z.infer<
  typeof ingestionPullRunCompletedDataSchema
>;
export type IngestionPullRunFailedData = z.infer<
  typeof ingestionPullRunFailedDataSchema
>;
