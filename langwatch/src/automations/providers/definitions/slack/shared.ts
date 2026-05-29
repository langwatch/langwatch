import { TriggerAction } from "@prisma/client";
import { z } from "zod";
import type { SharedDef } from "../../types";

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

const def: SharedDef = {
  action: TriggerAction.SEND_SLACK_MESSAGE,
  category: "notify",
  label: "Slack",
  description: "Post a message to a Slack webhook when a trace matches.",
  actionParamsSchema: slackActionParamsSchema,
};

export default def;
