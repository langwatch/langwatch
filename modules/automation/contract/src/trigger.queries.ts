import type { Named } from "@langwatch/module";
import { z } from "zod";

import type { NotificationCadence } from "./cadences.ts";
import type { AlertType, TriggerAction, TriggerKind, TriggerTemplate } from "./trigger.ts";
export type TriggerSummary = {
  id: string;
  projectId: string;
  name: string;
  action: TriggerAction;
  triggerKind: TriggerKind;
  actionParams: Record<string, unknown>;
  filters: Record<string, unknown>;
  filterQuery: string | null;
  alertType: AlertType | null;
  message: string | null;
  customGraphId: string | null;
  notificationCadence: NotificationCadence;
  traceDebounceMs: number;
  templates: TriggerTemplate;
};
const reportScheduleStatusSchemaDefinition = z.object({
  triggerId: z.string(),
  nextRunAt: z.date().nullable(),
  lastRunAt: z.date().nullable(),
  active: z.boolean(),
});
export interface ReportScheduleStatusSchema extends Named<
  typeof reportScheduleStatusSchemaDefinition
> {}
export const reportScheduleStatusSchema: ReportScheduleStatusSchema =
  reportScheduleStatusSchemaDefinition;
export type ReportSchedule = z.infer<typeof reportScheduleStatusSchema>;

/** A run (scheduled or run-now) whose dispatch is neither sent nor finally failed. */
const reportRunInFlightSchemaDefinition = z.object({
  requestId: z.string(),
  slot: z.date(),
  since: z.date(),
});
export interface ReportRunInFlightSchema extends Named<typeof reportRunInFlightSchemaDefinition> {}
export const reportRunInFlightSchema: ReportRunInFlightSchema = reportRunInFlightSchemaDefinition;
export type ReportRunInFlight = z.infer<typeof reportRunInFlightSchema>;

/** One report's schedule as the operator scheduler lists it, across projects. */
const operatorReportScheduleSchemaDefinition = z.object({
  ...reportScheduleStatusSchema.shape,
  projectId: z.string(),
  cron: z.string(),
  timezone: z.string(),
  running: reportRunInFlightSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export interface OperatorReportScheduleSchema extends Named<
  typeof operatorReportScheduleSchemaDefinition
> {}
export const operatorReportScheduleSchema: OperatorReportScheduleSchema =
  operatorReportScheduleSchemaDefinition;
export type OperatorReportSchedule = z.infer<typeof operatorReportScheduleSchema>;

const triggerFireStatsSchemaDefinition = z.object({
  triggerId: z.string(),
  lastFiredAt: z.date().nullable(),
  recentFireCount: z.number(),
  currentlyFiring: z.boolean(),
});
export interface TriggerFireStatsSchema extends Named<typeof triggerFireStatsSchemaDefinition> {}
export const triggerFireStatsSchema: TriggerFireStatsSchema = triggerFireStatsSchemaDefinition;
export type TriggerFireStats = z.infer<typeof triggerFireStatsSchema>;

const triggerFireRowSchemaDefinition = z.object({
  id: z.string(),
  triggerId: z.string(),
  customGraphId: z.string().nullable(),
  createdAt: z.date(),
  resolvedAt: z.date().nullable(),
});
export interface TriggerFireRowSchema extends Named<typeof triggerFireRowSchemaDefinition> {}
export const triggerFireRowSchema: TriggerFireRowSchema = triggerFireRowSchemaDefinition;
export type TriggerFire = z.infer<typeof triggerFireRowSchema>;

export type AutomationFireStats = {
  triggerId: string;
  lastFiredAt: TriggerFireStats["lastFiredAt"];
  recentFireCount: number;
};
