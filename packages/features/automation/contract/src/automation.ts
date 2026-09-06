import { z } from "zod";
import { triggerActionSchema, triggerKindSchema, triggerSchema } from "./trigger";
import type { Trigger, TriggerAction, TriggerKind } from "./trigger";

/** Compatibility aliases for callers that still use the old noun. The
 * canonical domain model is Trigger; this file intentionally does not define
 * a second persisted automation shape. */
export const automationIdSchema = z.string().min(1).brand<"AutomationId">();
export const automationActionSchema = triggerActionSchema;
export const automationKindSchema = triggerKindSchema;
export const automationSchema = triggerSchema;
export type AutomationId = z.infer<typeof automationIdSchema>;
export type Automation = Trigger;
export type AutomationAction = TriggerAction;
export type AutomationKind = TriggerKind;

export const emailSuppressionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  email: z.string().email(),
  triggerId: z.string().nullable(),
  reason: z.string(),
  createdAt: z.date(),
});
export type EmailSuppression = z.infer<typeof emailSuppressionSchema>;

export const triggerFireSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  triggerId: z.string(),
  traceId: z.string().nullable(),
  createdAt: z.date(),
  status: z.string().optional(),
});

/** The masked recipient and names behind an unsubscribe token. */
export const unsubscribeViewSchema = z.object({
  projectName: z.string(),
  triggerName: z.string().nullable(),
  email: z.string(),
});
export type UnsubscribeView = z.infer<typeof unsubscribeViewSchema>;

/**
 * One suppression row as the operator table renders it: the stored row minus
 * the project id the caller already named, plus its automation's name.
 */
export const emailSuppressionRowSchema = emailSuppressionSchema
  .omit({ projectId: true })
  .extend({ triggerName: z.string().nullable() });
export type EmailSuppressionRow = z.infer<typeof emailSuppressionRowSchema>;

/** What the email-suppression writes answer with: the write landed. */
export const emailSuppressionAcknowledgedSchema = z.object({ ok: z.boolean() }).strict();
