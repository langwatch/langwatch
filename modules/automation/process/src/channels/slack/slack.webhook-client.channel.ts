import type { SlackPayload } from "@langwatch/automation-contract";
import { IncomingWebhook, type IncomingWebhookSendArguments } from "@slack/webhook";
import { z } from "zod";

const slackBlockSchema = z.looseObject({
  type: z.string(),
  block_id: z.string().optional(),
});

const SLACK_WEBHOOK_ORIGIN = "https://hooks.slack.com";

// Slack incoming-webhook sender, created per send because webhook URLs are
// tenant-owned credentials that cannot be cached across tenants.
export class SlackWebhookClientChannel {
  static create(
    options: {
      /** Slack's incoming-webhook origin, or the stand-in a dev stack names. */
      webhookBase?: string;
    } = {},
  ): SlackWebhookClientChannel {
    return new SlackWebhookClientChannel(
      (options.webhookBase ?? SLACK_WEBHOOK_ORIGIN).replace(/\/+$/, ""),
    );
  }

  private constructor(private readonly webhookBase: string) {}

  /** The URL a send reaches: a Slack webhook's path under the configured origin. */
  private addressed(webhook: string): string {
    return webhook.startsWith(`${SLACK_WEBHOOK_ORIGIN}/`)
      ? this.webhookBase + webhook.slice(SLACK_WEBHOOK_ORIGIN.length)
      : webhook;
  }

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

    await new IncomingWebhook(this.addressed(input.webhook)).send(request);
  }
}
