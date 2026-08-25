import type { AlertType, TriggerAction, TriggerKind } from "~/generated/prisma/client";
import type { NotificationCadence } from "@langwatch/automation-contract";
import type { TriggerFilters } from "~/server/filters/types";

/** App transport shape consumed by older eventing dispatch adapters. The
 * canonical feature returns a portable summary; the transport edge maps it
 * here when a legacy Prisma shape is still required. */
export interface TriggerSummary {
  id: string;
  projectId: string;
  name: string;
  action: TriggerAction;
  triggerKind: TriggerKind;
  actionParams: unknown;
  filters: TriggerFilters;
  filterQuery: string | null;
  alertType: AlertType | null;
  message: string | null;
  customGraphId: string | null;
  notificationCadence: NotificationCadence;
  traceDebounceMs: number;
  templates: {
    slackTemplateType: string | null;
    slackTemplate: string | null;
    emailSubjectTemplate: string | null;
    emailBodyTemplate: string | null;
  };
}
