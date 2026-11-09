import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const RETENTION_STORAGE_REPORT_PIPELINE_NAME = "data_retention_storage_report";
export const RETENTION_STORAGE_REPORT_PROCESS_NAME = "retentionStorageReport";

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

/** Pure and synchronous: the measuring itself is an intent, run behind the outbox lease. */
export const retentionStorageReportWake: WakeHandler<
  RetentionStorageReportState,
  RetentionStorageReportIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intent("sweep", `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
