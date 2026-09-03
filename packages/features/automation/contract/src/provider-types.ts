import type { ZodTypeAny } from "zod";
import type { AlertType, TriggerAction } from "./trigger";

export type Category = "notify" | "action";

export interface PreviewEnvelope {
  usedDefault: boolean;
  missingVariables: string[];
  errors: string[];
}

export interface SavedTriggerRow {
  id: string;
  name: string;
  alertType: AlertType | null;
  action: TriggerAction;
  actionParams: unknown;
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
  slackTemplate: string | null;
  slackTemplateType: string | null;
}

export type SlackTemplateTypeColumn = "string" | "block_kit" | null;

export interface TemplateDraft {
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
  slackTemplate: string | null;
  slackTemplateType: SlackTemplateTypeColumn;
}

export interface SharedDef {
  readonly action: TriggerAction;
  readonly category: Category;
  readonly label: string;
  readonly description: string;
  readonly alertDescription?: string;
  readonly actionParamsSchema: ZodTypeAny;
}
