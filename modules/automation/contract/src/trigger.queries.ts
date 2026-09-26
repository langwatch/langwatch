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
export const reportScheduleStatusSchema = z.object({
  triggerId: z.string(),
  nextRunAt: z.date().nullable(),
  lastRunAt: z.date().nullable(),
  active: z.boolean(),
});
export type ReportSchedule = z.infer<typeof reportScheduleStatusSchema>;

/** One report's schedule as the operator scheduler lists it, across projects. */
export const operatorReportScheduleSchema = z.object({
  ...reportScheduleStatusSchema.shape,
  projectId: z.string(),
  cron: z.string(),
  timezone: z.string(),
  /** The slot of a run-now whose dispatch has not yet been sent or finally failed. */
  runningSlot: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type OperatorReportSchedule = z.infer<typeof operatorReportScheduleSchema>;

export const triggerFireStatsSchema = z.object({
  triggerId: z.string(),
  lastFiredAt: z.date().nullable(),
  recentFireCount: z.number(),
  currentlyFiring: z.boolean(),
});
export type TriggerFireStats = z.infer<typeof triggerFireStatsSchema>;

export const triggerFireRowSchema = z.object({
  id: z.string(),
  triggerId: z.string(),
  customGraphId: z.string().nullable(),
  createdAt: z.date(),
  resolvedAt: z.date().nullable(),
});
export type TriggerFire = z.infer<typeof triggerFireRowSchema>;
