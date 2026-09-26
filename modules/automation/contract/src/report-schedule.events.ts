import { z } from "zod";

export const REPORT_SCHEDULE_COMMAND_TYPES = {
  CONFIGURE: "lw.automation.report_schedule.configure",
  PAUSE: "lw.automation.report_schedule.pause",
  RESUME: "lw.automation.report_schedule.resume",
  REQUEST_RUN: "lw.automation.report_schedule.request_run",
  SETTLE_RUN: "lw.automation.report_schedule.settle_run",
} as const;

export const REPORT_SCHEDULE_EVENT_TYPES = {
  CONFIGURED: "lw.automation.report_schedule.configured",
  PAUSED: "lw.automation.report_schedule.paused",
  RESUMED: "lw.automation.report_schedule.resumed",
  RUN_REQUESTED: "lw.automation.report_schedule.run_requested",
  RUN_SETTLED: "lw.automation.report_schedule.run_settled",
} as const;

export const reportScheduleConfiguredEventDataSchema = z.object({
  triggerId: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().min(1),
});
export type ReportScheduleConfiguredEventData = z.infer<
  typeof reportScheduleConfiguredEventDataSchema
>;

export const reportScheduleTargetEventDataSchema = z.object({
  triggerId: z.string().min(1),
});
export type ReportScheduleTargetEventData = z.infer<typeof reportScheduleTargetEventDataSchema>;

export const reportRunRequestedEventDataSchema = z.object({
  triggerId: z.string().min(1),
  requestId: z.string().min(1),
});
export type ReportRunRequestedEventData = z.infer<typeof reportRunRequestedEventDataSchema>;

/** How a run-now's dispatch ended: sent, or failed on its final attempt. */
export const reportRunOutcomeSchema = z.enum(["sent", "failed"]);
export type ReportRunOutcome = z.infer<typeof reportRunOutcomeSchema>;

export const reportRunSettledEventDataSchema = z.object({
  triggerId: z.string().min(1),
  requestId: z.string().min(1),
  outcome: reportRunOutcomeSchema,
});
export type ReportRunSettledEventData = z.infer<typeof reportRunSettledEventDataSchema>;
