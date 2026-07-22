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

/**
 * Json column write values: Prisma's input side rejects a bare `null` (it
 * wants an explicit JsonNull sentinel), so write shapes exclude it.
 */
export type NonNullJsonValue = Exclude<JsonValue, null>;

/**
 * Creation data for a trigger row, as the domain speaks it. Assignable to
 * Prisma's `TriggerUncheckedCreateInput` (pinned by the app-side parity
 * test) so implementations pass it straight through.
 */
export interface TriggerCreateData {
  id?: string;
  projectId: string;
  name: string;
  action: TriggerAction;
  triggerKind?: TriggerKind;
  actionParams: NonNullJsonValue;
  filters: NonNullJsonValue;
  filterQuery?: string | null;
  message?: string | null;
  alertType?: AlertType | null;
  customGraphId?: string | null;
  active?: boolean;
  deleted?: boolean;
  lastRunAt?: number;
  slackTemplateType?: string | null;
  slackTemplate?: string | null;
  emailSubjectTemplate?: string | null;
  emailBodyTemplate?: string | null;
  notificationCadence?: string;
  traceDebounceMs?: number;
}

/**
 * Update data: any subset of the writable columns. Assignable to Prisma's
 * `TriggerUncheckedUpdateInput` (plain values, no field-operation objects),
 * pinned by the same parity test.
 */
export type TriggerUpdateData = Partial<TriggerCreateData>;
