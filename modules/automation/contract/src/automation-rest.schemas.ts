/**
 * What the automation REST doors send and answer: `/api/triggers`, the
 * older `/api/trigger/slack`, and `/api/unsubscribe` (RFC 8058) share
 * this file since every shape is one those doors already published.
 */
import { z } from "zod";

import { automationFiltersSchema } from "./automation-filters.ts";

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
export const slackAutomationRestInputSchema = z
  .object({
    slack_webhook: z
      .string()
      .url()
      .optional()
      .describe(
        "Incoming webhook URL the alert is posted to. It is stored as a Slack connection this " +
          "project can use (an existing one holding the same URL, else a new project connection). " +
          "Send this or `slack_connection_id`, not both.",
      ),
    slack_connection_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The Slack connection the alert posts through: an organization connection or one of " +
          "this project's, as `GET /api/slack-connections` and `langwatch slack-connection list` " +
          "list them. Send this or `slack_webhook`, not both.",
      ),
    slack_channel_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The channel a bot connection posts in; required with one. Invite the LangWatch app to it first.",
      ),
    name: z.string().describe("How the trigger is listed in the app"),
    message: z.string().optional().describe("Extra line included with each alert"),
    filters: automationFiltersSchema
      .default({})
      .describe("Which traces the trigger fires on. An empty object fires on all of them."),
    alert_type: automationRestAlertTypeSchema,
  })
  .refine(
    (body) => (body.slack_webhook === undefined) !== (body.slack_connection_id === undefined),
    {
      message: "Send exactly one of slack_webhook or slack_connection_id.",
      path: ["slack_connection_id"],
    },
  );

/** The one sentence `/api/trigger/slack` answers a successful create with. */
export const slackAutomationRestCreatedSchema = z.object({ message: z.string() });

/** What the mail client reads back from `/api/unsubscribe`. */
export const unsubscribeRestAcknowledgedSchema = z.object({ ok: z.boolean() });
