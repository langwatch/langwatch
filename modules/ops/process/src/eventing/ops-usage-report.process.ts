import type { IntentSpec, ProcessManagerApplier, WakeHandler, Event } from "@langwatch/eventing";
import { z } from "zod";

import { isUsageReportDue } from "../rules/usage-report-schedule.rules.ts";
import { runUsageReport, type UsageReportRunDeps } from "./ops-usage-report.intent.ts";

export const USAGE_REPORT_PROCESS_NAME = "usageReport" as const;

/** Hourly, so the report goes on the first wake after 12:00 UTC and a restart never skips a day. */
export const USAGE_REPORT_WAKE_INTERVAL_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UsageReportScheduleState {
  /** Epoch ms of the last report this process asked for, or of its first wake. */
  lastReportAt: number | null;
}

const sendSchema = z.object({ scheduledFor: z.number().int() });

type UsageReportIntents = {
  send: IntentSpec<typeof sendSchema>;
};

/**
 * The first wake only takes a baseline, so a new install's first report goes
 * at the next 12:00 UTC, as the checkup page promises. The intent is keyed by
 * the UTC day, so a redelivered wake asks for that day's report once.
 */
export const usageReportWake: WakeHandler<UsageReportScheduleState, UsageReportIntents> = (
  state,
  ctx,
) => {
  const at = Math.max(ctx.at, ctx.now);
  if (state.lastReportAt === null) return { state: { lastReportAt: at } };
  if (!isUsageReportDue({ at, lastReportAt: state.lastReportAt })) return { state };
  return {
    state: { lastReportAt: at },
    intents: [ctx.intents.send(`send:${Math.floor(at / DAY_MS)}`, { scheduledFor: at })],
  };
};

/** One instance for the whole install: the report describes the install, not a tenant. */
export function usageReportPM(deps: UsageReportRunDeps): ProcessManagerApplier<Event> {
  return (pm) =>
    pm
      .state<UsageReportScheduleState>({ lastReportAt: null })
      .schedule({ everyMs: USAGE_REPORT_WAKE_INTERVAL_MS })
      .onWake(usageReportWake)
      .intent("send", sendSchema, runUsageReport(deps))
      // Collecting reads every table the report counts, across every project.
      .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 10 * 60 * 1000 });
}
