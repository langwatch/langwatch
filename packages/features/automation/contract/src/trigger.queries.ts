import type { Trigger } from "./trigger";
export type TriggerSummary = Pick<
  Trigger,
  | "id"
  | "projectId"
  | "name"
  | "action"
  | "triggerKind"
  | "actionParams"
  | "filters"
  | "filterQuery"
  | "alertType"
  | "message"
  | "customGraphId"
  | "notificationCadence"
  | "traceDebounceMs"
  | "templates"
>;
export type ReportSchedule = {
  triggerId: string;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  active: boolean;
};
export type TriggerFireStats = {
  triggerId: string;
  lastFiredAt: Date | null;
  recentFireCount: number;
  currentlyFiring: boolean;
};
export type TriggerFire = {
  id: string;
  triggerId: string;
  customGraphId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
};
