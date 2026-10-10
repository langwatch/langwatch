import type { Named } from "@langwatch/module";
import { z } from "zod";

import { triggerActionSchema, triggerKindSchema, triggerSchema } from "./trigger.ts";
import type { Trigger, TriggerAction, TriggerKind } from "./trigger.ts";

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

const emailSuppressionSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  email: z.string().email(),
  triggerId: z.string().nullable(),
  reason: z.string(),
  createdAt: z.date(),
});
export interface EmailSuppressionSchema extends Named<typeof emailSuppressionSchemaDefinition> {}
export const emailSuppressionSchema: EmailSuppressionSchema = emailSuppressionSchemaDefinition;
export type EmailSuppression = z.infer<typeof emailSuppressionSchema>;

const triggerFireSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  triggerId: z.string(),
  traceId: z.string().nullable(),
  createdAt: z.date(),
  status: z.string().optional(),
});
export interface TriggerFireSchema extends Named<typeof triggerFireSchemaDefinition> {}
export const triggerFireSchema: TriggerFireSchema = triggerFireSchemaDefinition;

/** The masked recipient and names behind an unsubscribe token. */
const unsubscribeViewSchemaDefinition = z.object({
  projectName: z.string(),
  triggerName: z.string().nullable(),
  email: z.string(),
});
export interface UnsubscribeViewSchema extends Named<typeof unsubscribeViewSchemaDefinition> {}
export const unsubscribeViewSchema: UnsubscribeViewSchema = unsubscribeViewSchemaDefinition;
export type UnsubscribeView = z.infer<typeof unsubscribeViewSchema>;

/**
 * One suppression row as the operator table renders it: the stored row minus
 * the project id the caller already named, plus its automation's name.
 */
const emailSuppressionRowSchemaDefinition = z.object({
  ...emailSuppressionSchema.omit({ projectId: true }).shape,
  triggerName: z.string().nullable(),
});
export interface EmailSuppressionRowSchema extends Named<
  typeof emailSuppressionRowSchemaDefinition
> {}
export const emailSuppressionRowSchema: EmailSuppressionRowSchema =
  emailSuppressionRowSchemaDefinition;
export type EmailSuppressionRow = z.infer<typeof emailSuppressionRowSchema>;

/** What the email-suppression writes answer with: the write landed. */
const emailSuppressionAcknowledgedSchemaDefinition = z.object({ ok: z.boolean() }).strict();
export interface EmailSuppressionAcknowledgedSchema extends Named<
  typeof emailSuppressionAcknowledgedSchemaDefinition
> {}
export const emailSuppressionAcknowledgedSchema: EmailSuppressionAcknowledgedSchema =
  emailSuppressionAcknowledgedSchemaDefinition;

/** The public unsubscribe view masks both the address and its local-part
 * length. This pure contract helper is shared by server and web surfaces. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at <= 0 ? "***" : `${email[0]}***${email.slice(at)}`;
}
