import { z } from "zod";
import { NOTIFICATION_CADENCES } from "./cadences";

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
export const triggerTemplateSchema = z.object({
  slackTemplateType: z.string().nullable(),
  slackTemplate: z.string().nullable(),
  emailSubjectTemplate: z.string().nullable(),
  emailBodyTemplate: z.string().nullable(),
});
export const triggerSchema = z.object({
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
export type Trigger = z.infer<typeof triggerSchema>;
export type TriggerAction = z.infer<typeof triggerActionSchema>;
export type TriggerKind = z.infer<typeof triggerKindSchema>;
export type AlertType = z.infer<typeof alertTypeSchema>;
export type TriggerTemplate = z.infer<typeof triggerTemplateSchema>;
