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
