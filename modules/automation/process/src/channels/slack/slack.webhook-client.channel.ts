import type { SlackPayload } from "@langwatch/automation-contract";
import { IncomingWebhook, type IncomingWebhookSendArguments } from "@slack/webhook";
import { z } from "zod";

const slackBlockSchema = z.looseObject({
  type: z.string(),
  block_id: z.string().optional(),
});

// Slack incoming-webhook sender, created per send because webhook URLs are
// tenant-owned credentials that cannot be cached across tenants.
export class SlackWebhookClientChannel {
  static create(): SlackWebhookClientChannel {
    return new SlackWebhookClientChannel();
  }

  private constructor() {}

  async send(input: {
    webhook: string;
    payload: SlackPayload & { username?: string; icon_emoji?: string };
  }): Promise<void> {
    const defaults = {
      username: input.payload.username,
      icon_emoji: input.payload.icon_emoji,
    };
    const request: IncomingWebhookSendArguments =
      "text" in input.payload
        ? { ...defaults, text: input.payload.text }
        : {
            ...defaults,
            blocks: input.payload.blocks.map((block) => slackBlockSchema.parse(block)),
          };

    await new IncomingWebhook(input.webhook).send(request);
  }
}
