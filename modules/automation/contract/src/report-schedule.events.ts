import type { Named } from "@langwatch/module";
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

const reportScheduleConfiguredEventDataSchemaDefinition = z.object({
  triggerId: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().min(1),
});
export interface ReportScheduleConfiguredEventDataSchema extends Named<
  typeof reportScheduleConfiguredEventDataSchemaDefinition
> {}
export const reportScheduleConfiguredEventDataSchema: ReportScheduleConfiguredEventDataSchema =
  reportScheduleConfiguredEventDataSchemaDefinition;
export type ReportScheduleConfiguredEventData = z.infer<
  typeof reportScheduleConfiguredEventDataSchema
>;

const reportScheduleTargetEventDataSchemaDefinition = z.object({
  triggerId: z.string().min(1),
});
export interface ReportScheduleTargetEventDataSchema extends Named<
  typeof reportScheduleTargetEventDataSchemaDefinition
> {}
export const reportScheduleTargetEventDataSchema: ReportScheduleTargetEventDataSchema =
  reportScheduleTargetEventDataSchemaDefinition;
export type ReportScheduleTargetEventData = z.infer<typeof reportScheduleTargetEventDataSchema>;

const reportRunRequestedEventDataSchemaDefinition = z.object({
  triggerId: z.string().min(1),
  requestId: z.string().min(1),
});
export interface ReportRunRequestedEventDataSchema extends Named<
  typeof reportRunRequestedEventDataSchemaDefinition
> {}
export const reportRunRequestedEventDataSchema: ReportRunRequestedEventDataSchema =
  reportRunRequestedEventDataSchemaDefinition;
export type ReportRunRequestedEventData = z.infer<typeof reportRunRequestedEventDataSchema>;

/** How a run ended: sent, failed on its final attempt, or released by an operator as stale. */
export const reportRunOutcomeSchema = z.enum(["sent", "failed", "cleared"]);
export type ReportRunOutcome = z.infer<typeof reportRunOutcomeSchema>;

const reportRunSettledEventDataSchemaDefinition = z.object({
  triggerId: z.string().min(1),
  requestId: z.string().min(1),
  outcome: reportRunOutcomeSchema,
});
export interface ReportRunSettledEventDataSchema extends Named<
  typeof reportRunSettledEventDataSchemaDefinition
> {}
export const reportRunSettledEventDataSchema: ReportRunSettledEventDataSchema =
  reportRunSettledEventDataSchemaDefinition;
export type ReportRunSettledEventData = z.infer<typeof reportRunSettledEventDataSchema>;
