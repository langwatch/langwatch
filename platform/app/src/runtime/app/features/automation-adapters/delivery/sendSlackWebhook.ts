import { IncomingWebhook, type IncomingWebhookSendArguments } from "@slack/webhook";
import {
  SlackWebhookDeliveryAdapter,
  type RenderedSlackMessageRequest,
  type SlackWebhookRequest,
  type SlackWebhookTransport,
} from "@langwatch/automation-server";
import type { SlackPayload } from "@langwatch/automation-contract";
import { z } from "zod";

const slackBlockSchema = z.looseObject({
  type: z.string(),
  block_id: z.string().optional(),
});

function transportFor(webhook: string): SlackWebhookTransport {
  return {
    send: async (payload: SlackPayload & { username?: string; icon_emoji?: string }) => {
      const defaults = {
        username: payload.username,
        icon_emoji: payload.icon_emoji,
      };
      const request: IncomingWebhookSendArguments =
        "text" in payload
          ? { ...defaults, text: payload.text }
          : { ...defaults, blocks: payload.blocks.map((block) => slackBlockSchema.parse(block)) };
      await new IncomingWebhook(webhook).send(request);
    },
  };
}

const delivery = SlackWebhookDeliveryAdapter.create(transportFor);

export function sendSlackWebhook(input: SlackWebhookRequest): Promise<void> {
  return delivery.deliver(input);
}

export function sendRenderedSlackMessage(input: RenderedSlackMessageRequest): Promise<void> {
  return delivery.deliverRendered(input);
}
