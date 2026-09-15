/**
 * What the automation REST doors send and answer.
 *
 * Three families share this file because they share a subject: `/api/triggers`
 * (the project's automations), `/api/trigger/slack` (the one-action ancestor of
 * it) and `/api/unsubscribe` (RFC 8058 one-click). Every shape below is the one
 * those doors already published; nothing is reshaped.
 */
import { z } from "zod";

/** The four actions the REST family can create. It carries no webhook shape. */
export const automationRestActionSchema = z.enum([
  "SEND_EMAIL",
  "ADD_TO_DATASET",
  "ADD_TO_ANNOTATION_QUEUE",
  "SEND_SLACK_MESSAGE",
]);

export const automationRestAlertTypeSchema = z.enum(["CRITICAL", "WARNING", "INFO"]);

/** One automation, as `/api/triggers` has always written it. */
export const automationRestResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  action: automationRestActionSchema,
  actionParams: z.record(z.string(), z.unknown()),
  filters: z.record(z.string(), z.unknown()),
  active: z.boolean(),
  message: z.string().nullable(),
  alertType: automationRestAlertTypeSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  platformUrl: z.string().url(),
});
export type AutomationRestResponse = z.infer<typeof automationRestResponseSchema>;

export const automationRestIdParamsSchema = z.object({ id: z.string().min(1) });

export const automationRestCreateInputSchema = z.object({
  name: z.string().min(1, "name is required"),
  action: automationRestActionSchema,
  actionParams: z.record(z.string(), z.unknown()).default({}),
  // No default. An omitted condition used to become `{}`, which matches every
  // trace forever, so the easiest possible create call produced the most
  // expensive possible automation. Omitting it is now the same as sending an
  // empty one, and both are refused with a typed 422.
  filters: z.record(z.string(), z.unknown()).optional(),
  message: z.string().optional(),
  alertType: automationRestAlertTypeSchema.optional(),
});

/**
 * Delivery settings are declared here only so an edit that carries them is
 * REFUSED rather than silently dropped. They are not updatable through REST:
 * the per-action shape check, the secret encryption and the unconditional
 * `createdByUserId` stamp all live on the authoring surface, and a forwarded
 * record would skip every one of them.
 */
export const automationRestUpdateInputSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  message: z.string().nullable().optional(),
  alertType: automationRestAlertTypeSchema.nullable().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  actionParams: z.record(z.string(), z.unknown()).optional(),
});

export const automationRestDeletedSchema = z.object({
  id: z.string(),
  deleted: z.boolean(),
});

/** The body `/api/trigger/slack` reads, in its own spelling. */
export const slackAutomationRestInputSchema = z.object({
  slack_webhook: z.string().url().describe("Incoming webhook URL the alert is posted to"),
  name: z.string().describe("How the trigger is listed in the app"),
  message: z.string().optional().describe("Extra line included with each alert"),
  filters: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("Which traces the trigger fires on. An empty object fires on all of them."),
  alert_type: automationRestAlertTypeSchema,
});

/** The one sentence `/api/trigger/slack` answers a successful create with. */
export const slackAutomationRestCreatedSchema = z.object({ message: z.string() });

/** The refusals `/api/trigger/slack` publishes, in the shape its callers parse. */
export const slackAutomationRestRefusalSchema = z.object({
  message: z.string(),
  errors: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("The individual validation failures, when present"),
});

/** What the mail client reads back from `/api/unsubscribe`. */
export const unsubscribeRestAcknowledgedSchema = z.object({ ok: z.boolean() });

/** Every refusal `/api/unsubscribe` words, in the one-word body it always has. */
export const unsubscribeRestRefusalSchema = z.object({ error: z.string() });
