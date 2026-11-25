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

/**
 * Where a suppression page resumes: the `(createdAt, id)` of the last row of
 * the page before. A position, not a reference, so a row removed between pages
 * never breaks the walk.
 */
const emailSuppressionCursorSchemaDefinition = z.object({
  createdAt: z.coerce.date(),
  id: z.string().min(1),
});
export interface EmailSuppressionCursorSchema extends Named<
  typeof emailSuppressionCursorSchemaDefinition
> {}
export const emailSuppressionCursorSchema: EmailSuppressionCursorSchema =
  emailSuppressionCursorSchemaDefinition;
export type EmailSuppressionCursor = z.infer<typeof emailSuppressionCursorSchema>;

/** One page of a project's suppression list, resuming after `cursor` when one is given. */
const emailSuppressionPageInputSchemaDefinition = z.object({
  projectId: z.string(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: emailSuppressionCursorSchema.nullish(),
});
export interface EmailSuppressionPageInputSchema extends Named<
  typeof emailSuppressionPageInputSchemaDefinition
> {}
export const emailSuppressionPageInputSchema: EmailSuppressionPageInputSchema =
  emailSuppressionPageInputSchemaDefinition;
export type EmailSuppressionPageInput = z.infer<typeof emailSuppressionPageInputSchema>;

/** One page of suppression rows, newest first. `nextCursor` is null on the last page. */
const emailSuppressionPageSchemaDefinition = z.object({
  suppressions: emailSuppressionRowSchema.array(),
  nextCursor: emailSuppressionCursorSchema.nullable(),
});
export interface EmailSuppressionPageSchema extends Named<
  typeof emailSuppressionPageSchemaDefinition
> {}
export const emailSuppressionPageSchema: EmailSuppressionPageSchema =
  emailSuppressionPageSchemaDefinition;
export type EmailSuppressionPage = z.infer<typeof emailSuppressionPageSchema>;

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
