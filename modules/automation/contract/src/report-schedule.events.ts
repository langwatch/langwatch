import { z } from "zod";

export const REPORT_SCHEDULE_COMMAND_TYPES = {
  CONFIGURE: "lw.automation.report_schedule.configure",
  PAUSE: "lw.automation.report_schedule.pause",
  RESUME: "lw.automation.report_schedule.resume",
  REQUEST_RUN: "lw.automation.report_schedule.request_run",
} as const;

export const REPORT_SCHEDULE_EVENT_TYPES = {
  CONFIGURED: "lw.automation.report_schedule.configured",
  PAUSED: "lw.automation.report_schedule.paused",
  RESUMED: "lw.automation.report_schedule.resumed",
  RUN_REQUESTED: "lw.automation.report_schedule.run_requested",
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
