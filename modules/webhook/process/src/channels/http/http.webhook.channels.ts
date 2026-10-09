import { AwsClientConfiguration } from "@langwatch/aws-client";
import { parseOutboundProxyConfig } from "@langwatch/egress";
import type { WebhookServerConfig } from "@langwatch/webhook-contract";

import {
  SqsWebhookDestinationChannel,
  sqsProxyResolver,
} from "../sqs/sqs.webhook-destination.channel.ts";
import type { WebhookChannels } from "../webhook.channels.ts";
import { HttpDestinationChannel } from "./http.destination.channel.ts";

/** Batches leave over HTTP behind the egress fence, or to a customer's SQS queue. */
export class HttpWebhookChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: WebhookServerConfig }): WebhookChannels {
    const aws = AwsClientConfiguration.create({
      outboundProxy: sqsProxyResolver(parseOutboundProxyConfig(config.outboundProxy)),
    });
    return {
      http: HttpDestinationChannel.create({ tls: { rejectUnauthorized: config.isSaas } }),
      sqs: SqsWebhookDestinationChannel.create({ awsClientConfig: (input) => aws.build(input) }),
    };
  }
}
