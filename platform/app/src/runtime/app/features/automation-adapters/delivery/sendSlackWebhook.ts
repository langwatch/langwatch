import {
  SlackWebhookDeliveryAdapter,
  type RenderedSlackMessageRequest,
  type SlackWebhookRequest,
  type SlackWebhookTransport,
} from "@langwatch/automation-server";
import type { SlackPayload } from "@langwatch/automation-contract";
import { AppSlackWebhookClientAdapter } from "./slack-webhook.client.adapter";

function transportFor(
  webhook: string,
  client: AppSlackWebhookClientAdapter,
): SlackWebhookTransport {
  return {
    send: async (payload: SlackPayload & { username?: string; icon_emoji?: string }) => {
      await client.send({ webhook, payload });
    },
  };
}

/**
 * Process-local Slack delivery adapter. The adapter itself is process-owned,
 * while each send builds a fresh SDK sender for its tenant-owned webhook URL.
 */
export class AppSlackWebhookDeliveryRuntime {
  static create(
    input: {
      client?: AppSlackWebhookClientAdapter;
    } = {},
  ): AppSlackWebhookDeliveryRuntime {
    return new AppSlackWebhookDeliveryRuntime(
      input.client ?? AppSlackWebhookClientAdapter.create(),
    );
  }

  private readonly delivery: SlackWebhookDeliveryAdapter;

  private constructor(private readonly client: AppSlackWebhookClientAdapter) {
    this.delivery = SlackWebhookDeliveryAdapter.create((webhook) =>
      transportFor(webhook, this.client),
    );
  }

  deliver(input: SlackWebhookRequest): Promise<void> {
    return this.delivery.deliver(input);
  }

  deliverRendered(input: RenderedSlackMessageRequest): Promise<void> {
    return this.delivery.deliverRendered(input);
  }
}

const delivery = AppSlackWebhookDeliveryRuntime.create();

export function sendSlackWebhook(input: SlackWebhookRequest): Promise<void> {
  return delivery.deliver(input);
}

export function sendRenderedSlackMessage(input: RenderedSlackMessageRequest): Promise<void> {
  return delivery.deliverRendered(input);
}
