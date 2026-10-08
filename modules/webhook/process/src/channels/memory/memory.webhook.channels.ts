import type { WebhookServerConfig } from "@langwatch/webhook-contract";

import { HttpDestinationChannel } from "../http/http.destination.channel.ts";
import type { WebhookChannels } from "../webhook.channels.ts";
import { MemorySqsWebhookDestinationChannel } from "./memory.sqs-webhook-destination.channel.ts";

/** SQS sends are recorded in-process; HTTP keeps the live fence, as before the registry. */
export class MemoryWebhookChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: WebhookServerConfig }): WebhookChannels {
    return {
      http: HttpDestinationChannel.create({ tls: { rejectUnauthorized: config.isSaas } }),
      sqs: MemorySqsWebhookDestinationChannel.create(),
    };
  }
}
