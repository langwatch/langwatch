import { TriggerAction } from "@prisma/client";
import { z } from "zod";
import type { PreviewEnvelope, SharedDef } from "../../types";

export const SLACK_TEMPLATE_TYPES = ["string", "block_kit"] as const;

/** The two Slack message-template shapes a notify trigger can carry. Plain
 *  text (`string`) or a Block Kit JSON layout. Stored on the Trigger row's
 *  `slackTemplateType` column, not inside `actionParams`. */
export const slackTemplateTypeSchema = z.enum(SLACK_TEMPLATE_TYPES);

export type SlackTemplateType = z.infer<typeof slackTemplateTypeSchema>;

/** How a Slack automation reaches Slack. `webhook` is a legacy incoming
 *  webhook (limited Block Kit); `bot` is a Slack app bot token posting via the
 *  Web API (`chat.postMessage`), which renders the newer chart/table/alert
 *  blocks. Absent = `webhook` (back-compat for rows saved before this). */
export const SLACK_DELIVERY_METHODS = ["webhook", "bot"] as const;
export const slackDeliveryMethodSchema = z.enum(SLACK_DELIVERY_METHODS);
export type SlackDeliveryMethod = (typeof SLACK_DELIVERY_METHODS)[number];

/** Sentinel the read path substitutes for a stored bot token so the ciphertext
 *  never leaves the server; the edit path treats it (or blank) as "keep the
 *  existing token". */
export const SLACK_BOT_TOKEN_KEPT = "__kept__";

export const slackActionParamsSchema = z
  .object({
    slackDelivery: slackDeliveryMethodSchema.optional(),
    slackWebhook: z.string().optional(),
    /** Bot token — encrypted at rest server-side; never sent to the browser
     *  (redacted to a "set" flag on read). */
    slackBotToken: z.string().optional(),
    slackChannelId: z.string().optional(),
    /** Read-only echo the server sets so the form can show "token set"
     *  without ever receiving the token itself. */
    slackBotTokenSet: z.boolean().optional(),
  })
  .superRefine((p, ctx) => {
    const method = p.slackDelivery ?? "webhook";
    if (method === "webhook") {
      const url = p.slackWebhook?.trim();
      if (!url) {
        ctx.addIssue({
          code: "custom",
          message: "A Slack incoming webhook URL is required.",
          path: ["slackWebhook"],
        });
      } else if (!url.startsWith("https://hooks.slack.com/")) {
        ctx.addIssue({
          code: "custom",
          message: "Expected a Slack incoming webhook URL (https://hooks.slack.com/…).",
          path: ["slackWebhook"],
        });
      }
    } else if (!p.slackChannelId?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "A Slack channel is required for a bot connection.",
        path: ["slackChannelId"],
      });
    }
  });

export type SlackActionParams = z.infer<typeof slackActionParamsSchema>;

/** Resolve the effective delivery method (defaulting a legacy row to webhook). */
export function slackDeliveryMethodOf(
  params: Pick<SlackActionParams, "slackDelivery">,
): SlackDeliveryMethod {
  return params.slackDelivery ?? "webhook";
}

/** Frontend-shaped Slack payload (mirrors the server's `SlackPayload`).
 *  Kept local to the slack provider so `types.ts` stays channel-agnostic. */
export type SlackPreviewPayload =
  | { text: string }
  | { blocks: Record<string, unknown>[] };

/** The render-time preview shape this provider's ConfigForm consumes.
 *  Mirrors the server's `SlackPreview` from `trigger-template.service`. */
export interface SlackPreview extends PreviewEnvelope {
  channel: "slack";
  payload: SlackPreviewPayload;
}

const def: SharedDef = {
  action: TriggerAction.SEND_SLACK_MESSAGE,
  category: "notify",
  label: "Slack",
  description: "Post a message to a Slack webhook when a trace matches.",
  alertDescription: "Post a message to a Slack webhook when the alert fires.",
  actionParamsSchema: slackActionParamsSchema,
};

export default def;
