import type { Named } from "@langwatch/module";
import { z } from "zod";

import { NOTIFICATION_CADENCES } from "./cadences.ts";

export const triggerActionSchema = z.enum([
  "SEND_EMAIL",
  "ADD_TO_DATASET",
  "ADD_TO_ANNOTATION_QUEUE",
  "SEND_SLACK_MESSAGE",
  "SEND_WEBHOOK",
]);
export const triggerKindSchema = z.enum(["AUTOMATION", "ALERT", "REPORT"]);
export const alertTypeSchema = z.enum(["CRITICAL", "WARNING", "INFO"]);
export const notificationCadenceSchema = z.enum(NOTIFICATION_CADENCES);
const triggerTemplateSchemaDefinition = z.object({
  slackTemplateType: z.string().nullable(),
  slackTemplate: z.string().nullable(),
  emailSubjectTemplate: z.string().nullable(),
  emailBodyTemplate: z.string().nullable(),
});
export interface TriggerTemplateSchema extends Named<typeof triggerTemplateSchemaDefinition> {}
export const triggerTemplateSchema: TriggerTemplateSchema = triggerTemplateSchemaDefinition;

/**
 * A template set as an author's draft carries it: every column optional,
 * since the drawer sends only what it has. Also the legacy wire form
 * `parseTriggerTemplatesWire` accepts, so it's one schema, not two.
 */
const triggerTemplateDraftSchemaDefinition = z.object({
  slackTemplateType: z.string().nullable().optional(),
  slackTemplate: z.string().nullable().optional(),
  emailSubjectTemplate: z.string().nullable().optional(),
  emailBodyTemplate: z.string().nullable().optional(),
});
export interface TriggerTemplateDraftSchema extends Named<
  typeof triggerTemplateDraftSchemaDefinition
> {}
export const triggerTemplateDraftSchema: TriggerTemplateDraftSchema =
  triggerTemplateDraftSchemaDefinition;
export type TriggerTemplateDraft = z.infer<typeof triggerTemplateDraftSchema>;

const triggerTemplateWireSchema = z.union([
  z.object({ templates: triggerTemplateSchema }),
  triggerTemplateDraftSchema,
]);

export function parseTriggerTemplatesWire(value: unknown): TriggerTemplate {
  const parsed = triggerTemplateWireSchema.parse(value);
  const canonical = z.object({ templates: triggerTemplateSchema }).safeParse(parsed);
  if (canonical.success) {
    return canonical.data.templates;
  }

  const legacy = triggerTemplateDraftSchema.parse(parsed);
  return {
    slackTemplateType: legacy.slackTemplateType ?? null,
    slackTemplate: legacy.slackTemplate ?? null,
    emailSubjectTemplate: legacy.emailSubjectTemplate ?? null,
    emailBodyTemplate: legacy.emailBodyTemplate ?? null,
  };
}
const triggerSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  action: triggerActionSchema,
  triggerKind: triggerKindSchema,
  actionParams: z.record(z.string(), z.unknown()),
  filters: z.record(z.string(), z.unknown()),
  filterQuery: z.string().nullable(),
  active: z.boolean(),
  deleted: z.boolean(),
  pausedReason: z.string().nullable(),
  pausedAt: z.date().nullable(),
  message: z.string().nullable(),
  alertType: alertTypeSchema.nullable(),
  customGraphId: z.string().nullable(),
  notificationCadence: notificationCadenceSchema,
  traceDebounceMs: z.number().int().nonnegative(),
  templates: triggerTemplateSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  lastRunAt: z.date().nullable(),
});
export interface TriggerSchema extends Named<typeof triggerSchemaDefinition> {}
export const triggerSchema: TriggerSchema = triggerSchemaDefinition;
export type Trigger = z.infer<typeof triggerSchema>;
export type TriggerAction = z.infer<typeof triggerActionSchema>;
export type TriggerKind = z.infer<typeof triggerKindSchema>;
export type AlertType = z.infer<typeof alertTypeSchema>;
export type TriggerTemplate = z.infer<typeof triggerTemplateSchema>;
