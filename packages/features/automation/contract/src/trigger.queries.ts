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
