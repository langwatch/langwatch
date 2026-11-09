/**
 * The report's two processes: the daily clock, a scheduled singleton that hands one sweep to the
 * outbox, and the billing process, one per organization, that turns each day's measurement into
 * one `bill` intent. Pure and synchronous; the outbox carries the work and its retries.
 */
import type { RetentionStorageMeasuredEventData } from "@langwatch/data-retention-contract";
import { retentionStorageMeasuredEventDataSchema } from "@langwatch/data-retention-contract";
import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const RETENTION_STORAGE_REPORT_PROCESS_NAME = "retentionStorageReport";
export const RETENTION_STORAGE_BILLING_PROCESS_NAME = "retentionStorageBilling";

/** Daily: each day reports its own share of a GB-month, so the month sums to its average. */
export const RETENTION_STORAGE_REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const retentionStorageReportSweepSchema = z.object({ scheduledFor: z.number().int() });

export const retentionStorageReportStateSchema = z.object({ lastSweepAt: z.number().nullable() });
type RetentionStorageReportState = z.infer<typeof retentionStorageReportStateSchema>;

export const RETENTION_STORAGE_REPORT_INITIAL_STATE: RetentionStorageReportState = {
  lastSweepAt: null,
};

type RetentionStorageReportIntents = {
  sweep: IntentSpec<typeof retentionStorageReportSweepSchema>;
};

/** Keyed by the wake, so a redelivered wake asks for the sweep once. */
export const retentionStorageReportWake: WakeHandler<
  RetentionStorageReportState,
  RetentionStorageReportIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intent("sweep", `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

export const retentionStorageBillSchema = retentionStorageMeasuredEventDataSchema;

export const retentionStorageBillingStateSchema = z.object({
  /** The last day a bill was asked for; ISO days compare in calendar order. */
  lastBilledDay: z.string().nullable(),
});
type RetentionStorageBillingState = z.infer<typeof retentionStorageBillingStateSchema>;

export const RETENTION_STORAGE_BILLING_INITIAL_STATE: RetentionStorageBillingState = {
  lastBilledDay: null,
};

type RetentionStorageBillingIntents = {
  bill: IntentSpec<typeof retentionStorageBillSchema>;
};

/**
 * One bill per organization and day, keyed by the meter identifier. A replayed or repeated
 * measurement of a day already asked for, or of an earlier day, asks for nothing.
 */
export const retentionStorageMeasured: EventHandler<
  RetentionStorageBillingState,
  RetentionStorageMeasuredEventData,
  RetentionStorageBillingIntents
> = (state, data, ctx) => {
  if (state.lastBilledDay !== null && state.lastBilledDay >= data.day) return { state };
  return {
    state: { lastBilledDay: data.day },
    intents: [ctx.intent("bill", `bill:${data.identifier}`, data)],
  };
};
