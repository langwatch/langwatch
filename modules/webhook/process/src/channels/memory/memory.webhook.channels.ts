import type { WebhookServerConfig } from "@langwatch/webhook-contract";

import type { WebhookChannels } from "../webhook.channels.ts";
import { MemoryHttpDestinationChannel } from "./memory.http-destination.channel.ts";
import { MemorySqsWebhookDestinationChannel } from "./memory.sqs-webhook-destination.channel.ts";

/** HTTP and SQS sends are recorded in-process; nothing leaves the process. */
export class MemoryWebhookChannels {
  static readonly requires = [] as const;

  static create(_input: { config: WebhookServerConfig }): WebhookChannels {
    return {
      http: MemoryHttpDestinationChannel.create(),
      sqs: MemorySqsWebhookDestinationChannel.create(),
    };
  }
}
