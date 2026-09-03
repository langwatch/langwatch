import type { SlackPayload } from "@langwatch/automation-contract";
import { IncomingWebhook, type IncomingWebhookSendArguments } from "@slack/webhook";
import { z } from "zod";

const slackBlockSchema = z.looseObject({
  type: z.string(),
  block_id: z.string().optional(),
});

/**
 * The Slack incoming-webhook sender, built fresh for each send.
 *
 * The SDK has no process-wide client worth retaining, and a webhook URL is a
 * TENANT-OWNED credential: caching one sender across tenants would keep one
 * customer's endpoint alive inside a process serving all of them. So the
 * sender is created at the dispatch boundary and discarded with the send.
 *
 * The URL is not validated here. `SlackWebhookDeliveryAdapter` in
 * `@langwatch/automation-server` refuses anything that is not a genuine
 * `https://hooks.slack.com/services/` endpoint before this is reached, and
 * that refusal belongs with the policy rather than with the transport.
 *
 * Twin of `platform/app/src/runtime/app/features/automation-adapters/delivery/
 * slack-webhook.client.adapter.ts`, which stays as it is while both processes
 * send: a payload shaped one way here and another way there would render two
 * different messages from one automation.
 */
export class WorkerSlackWebhookClientAdapter {
  static create(): WorkerSlackWebhookClientAdapter {
    return new WorkerSlackWebhookClientAdapter();
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
