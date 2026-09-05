import type { WebhookDispatchRateLimiterPort, WebhookEgressService } from "@langwatch/egress";

import type { WebhookDestinationPort } from "../ports/webhook-destination.port";
import type { WebhookDestinationConfig } from "../services/webhook-destination.service";
import { HttpWebhookDestinationAdapter } from "./http.webhook-destination.adapter";
import {
  type AwsClientConfigPort,
  SqsWebhookDestinationAdapter,
} from "./sqs.webhook-destination.adapter";

/**
 * What a process must hold before it can deliver to either transport.
 *
 * Both are the deployment's, not the feature's: the egress service carries the
 * SSRF fence, the TLS policy and the one hourly dispatch cap, and the AWS
 * config carries the corporate proxy a self-hosted install routes through. A
 * package that built either for itself would quietly opt out of both.
 */
export type WebhookDestinationDeps = Readonly<{
  egress: WebhookEgressService;
  allowInsecureLocal: boolean;
  awsClientConfig: AwsClientConfigPort;
  /**
   * The counter the hourly dispatch cap is kept in. The HTTPS transport reads
   * it off the egress service; a queue send never passes through that sender,
   * so it has to be handed the same counter directly or a queue endpoint would
   * be the one uncapped destination.
   */
  rateLimiter?: WebhookDispatchRateLimiterPort | undefined;
}>;

/** Picks the transport one endpoint's configuration names. */
export class WebhookDestinationAdapter {
  private constructor(private readonly deps: WebhookDestinationDeps) {}

  static create(deps: WebhookDestinationDeps): WebhookDestinationAdapter {
    return new WebhookDestinationAdapter(deps);
  }

  /** The transport for one endpoint. */
  destinationFor(config: WebhookDestinationConfig): WebhookDestinationPort {
    switch (config.kind) {
      case "http":
        return HttpWebhookDestinationAdapter.create({
          url: config.url,
          egress: this.deps.egress,
          allowInsecureLocal: this.deps.allowInsecureLocal,
        });
      case "sqs":
        return SqsWebhookDestinationAdapter.create({
          config: {
            queueUrl: config.queueUrl,
            roleArn: config.roleArn,
            externalId: config.externalId,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            awsClientConfig: this.deps.awsClientConfig,
            ...(this.deps.rateLimiter ? { rateLimiter: this.deps.rateLimiter } : {}),
          },
        });
    }
  }
}
