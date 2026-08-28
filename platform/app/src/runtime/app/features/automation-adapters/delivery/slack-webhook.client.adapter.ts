import { IncomingWebhook, type IncomingWebhookSendArguments } from "@slack/webhook";
import type { SlackPayload } from "@langwatch/automation-contract";
import { z } from "zod";

const slackBlockSchema = z.looseObject({
  type: z.string(),
  block_id: z.string().optional(),
});

/**
 * The Slack SDK has no process-wide client to retain. A webhook URL is a
 * tenant-owned credential, so create its short-lived sender at the dispatch
 * boundary rather than caching one across tenants.
 */
export class AppSlackWebhookClientAdapter {
  static create(): AppSlackWebhookClientAdapter {
    return new AppSlackWebhookClientAdapter();
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
