import { z } from "zod";
import type { AlertType, TriggerAction, TriggerKind, TriggerTemplate } from "./trigger";
import type { NotificationCadence } from "./cadences";
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
