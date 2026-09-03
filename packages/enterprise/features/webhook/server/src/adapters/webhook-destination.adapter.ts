import type { WebhookDispatchRateLimiterPort, WebhookEgressService } from "@langwatch/egress";

import type { WebhookDestination } from "../ports/webhook-destination.port";
import type { WebhookDestinationConfig } from "../services/webhook-destination.service";
import { httpWebhookDestination } from "./http.webhook-destination.adapter";
import { type AwsClientConfigPort, sqsWebhookDestination } from "./sqs.webhook-destination.adapter";

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

/** The transport for one endpoint. */
export function webhookDestinationFor(
  config: WebhookDestinationConfig,
  deps: WebhookDestinationDeps,
): WebhookDestination {
  switch (config.kind) {
    case "http":
      return httpWebhookDestination({
        url: config.url,
        egress: deps.egress,
        allowInsecureLocal: deps.allowInsecureLocal,
      });
    case "sqs":
      return sqsWebhookDestination({
        queueUrl: config.queueUrl,
        roleArn: config.roleArn,
        externalId: config.externalId,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        awsClientConfig: deps.awsClientConfig,
        ...(deps.rateLimiter ? { rateLimiter: deps.rateLimiter } : {}),
      });
  }
}
