import type { AlertType, TriggerAction, TriggerKind } from "../enums";
import type { JsonValue } from "../utils/json";

/**
 * The Trigger row as the domain speaks it — one field per scalar column of
 * the Prisma `Trigger` model, with no `@prisma/client` dependency. The
 * app-side parity test (`prismaEnumParity.unit.test.ts`) pins this shape
 * against the generated Prisma type, so a schema migration that adds or
 * retypes a column fails the typecheck until this mirrors it.
 */
export interface TriggerRow {
  id: string;
  name: string;
  projectId: string;
  action: TriggerAction;
  triggerKind: TriggerKind;
  actionParams: JsonValue;
  filters: JsonValue;
  filterQuery: string | null;
  lastRunAt: number;
  createdAt: Date;
  updatedAt: Date;
  active: boolean;
  message: string | null;
  deleted: boolean;
  alertType: AlertType | null;
  slackTemplateType: string | null;
  slackTemplate: string | null;
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
  notificationCadence: string;
  traceDebounceMs: number;
  customGraphId: string | null;
}
