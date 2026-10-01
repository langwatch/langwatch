import type { MessageAttributeValue } from "@aws-sdk/client-sqs";
import type { AwsClientConfig, AwsClientConfigInput } from "@langwatch/aws-client";

import type {
  HttpDestinationRequest,
  HttpDestinationResponse,
} from "./http/http.destination.channel.ts";

export type AwsClientConfigResolver = (input: AwsClientConfigInput) => AwsClientConfig;

export interface SqsDestinationConfig {
  queueUrl: string;
  roleArn?: string | null;
  externalId?: string | null;
  accessKeyId?: string | null;
  /** Decrypted at dispatch, never stored or logged in the clear. */
  secretAccessKey?: string | null;
}

export interface SqsWebhookDestinationMessage {
  config: SqsDestinationConfig;
  body: string;
  attributes: Record<string, MessageAttributeValue>;
}

export interface SqsWebhookSender {
  send(message: SqsWebhookDestinationMessage): Promise<string>;
  invalidate(queueUrl: string): void;
}

/** One request to a customer URL, through the address fence; TLS is the sender's own. */
export interface HttpWebhookSender {
  send(request: Omit<HttpDestinationRequest, "tls">): Promise<HttpDestinationResponse>;
}
