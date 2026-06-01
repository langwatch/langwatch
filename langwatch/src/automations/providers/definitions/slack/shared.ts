import { TriggerAction } from "@prisma/client";
import { z } from "zod";
import type { PreviewEnvelope, SharedDef } from "../../types";

export const SLACK_TEMPLATE_TYPES = ["string", "block_kit"] as const;

export const slackActionParamsSchema = z.object({
  slackWebhook: z
    .string()
    .url({ message: "Slack webhooks must be valid URLs." })
    .startsWith("https://hooks.slack.com/", {
      message: "Expected a Slack incoming webhook URL.",
    }),
});

export type SlackActionParams = z.infer<typeof slackActionParamsSchema>;

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
  actionParamsSchema: slackActionParamsSchema,
};

export default def;
