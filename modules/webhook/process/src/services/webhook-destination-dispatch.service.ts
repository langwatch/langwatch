import type { WebhookDispatchRateLimiter, WebhookEgressService } from "@langwatch/egress";

import type { WebhookDestination } from "../app/webhook.app.ts";
import type { SqsWebhookSender } from "../channels/webhook-destination.channel.ts";
import { HttpWebhookDestinationService } from "./http.webhook-destination.service.ts";
import { SqsWebhookDestinationService } from "./sqs.webhook-destination.service.ts";
import type { WebhookDestinationConfig } from "./webhook-destination.service.ts";

/**
 * What a process must hold before it can deliver to either transport.
 */
export type WebhookDestinationDeps = Readonly<{
  egress: WebhookEgressService;
  allowInsecureLocal: boolean;
  sqs: SqsWebhookSender;
  /**
   * The counter the hourly dispatch cap is kept in. The HTTPS transport reads it off the egress
   * service; a queue send never passes through that sender, so it has to be handed the same
   * counter directly or a queue endpoint would be the one uncapped destination.
   */
  rateLimiter?: WebhookDispatchRateLimiter | undefined;
}>;

/** Picks the transport one endpoint's configuration names. */
export class WebhookDestinationDispatchService {
  private constructor(private readonly deps: WebhookDestinationDeps) {}

  static create(deps: WebhookDestinationDeps): WebhookDestinationDispatchService {
    return new WebhookDestinationDispatchService(deps);
  }

  /** The transport for one endpoint. */
  destinationFor(config: WebhookDestinationConfig): WebhookDestination {
    switch (config.kind) {
      case "http":
        return HttpWebhookDestinationService.create({
          url: config.url,
          egress: this.deps.egress,
          allowInsecureLocal: this.deps.allowInsecureLocal,
        });
      case "sqs":
        return SqsWebhookDestinationService.create({
          config: {
            queueUrl: config.queueUrl,
            roleArn: config.roleArn,
            externalId: config.externalId,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            channel: this.deps.sqs,
            ...(this.deps.rateLimiter ? { rateLimiter: this.deps.rateLimiter } : {}),
          },
        });
    }
  }
}
