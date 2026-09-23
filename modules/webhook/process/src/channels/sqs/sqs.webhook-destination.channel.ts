import { createHash } from "node:crypto";

import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { AwsClientConfig } from "@langwatch/aws-client";

import { parseSqsQueueUrl, sqsHostFor } from "../../rules/sqs-queue-url.rules.ts";
import type {
  AwsClientConfigResolver,
  SqsDestinationConfig,
  SqsWebhookDestinationMessage,
  SqsWebhookSender,
} from "../webhook-destination.channel.ts";

interface SqsClient {
  send(command: SendMessageCommand): Promise<{ MessageId?: string | undefined }>;
  destroy(): void;
}

export type SqsClientFactory = (config: AwsClientConfig) => SqsClient;

const createSqsClient: SqsClientFactory = (config) => new SQSClient(config);

/**
 * The process-owned SQS transport. One channel is composed per process, and
 * keeps one SDK client per queue and credential identity so delivery attempts
 * reuse connection pools and resolved role sessions.
 */
export class SqsWebhookDestinationChannel implements SqsWebhookSender {
  readonly #clients = new Map<string, SqsClient>();
  readonly #awsClientConfig: AwsClientConfigResolver;
  readonly #createClient: SqsClientFactory;

  private constructor(options: {
    awsClientConfig: AwsClientConfigResolver;
    createClient: SqsClientFactory;
  }) {
    this.#awsClientConfig = options.awsClientConfig;
    this.#createClient = options.createClient;
  }

  static create(options: {
    awsClientConfig: AwsClientConfigResolver;
    createClient?: SqsClientFactory;
  }): SqsWebhookDestinationChannel {
    return new SqsWebhookDestinationChannel({
      awsClientConfig: options.awsClientConfig,
      createClient: options.createClient ?? createSqsClient,
    });
  }

  async send(message: SqsWebhookDestinationMessage): Promise<string> {
    const client = this.#clientFor(message.config);
    const answer = await client.send(
      new SendMessageCommand({
        QueueUrl: message.config.queueUrl,
        MessageBody: message.body,
        MessageAttributes: message.attributes,
      }),
    );

    return answer.MessageId ?? "";
  }

  /** Drop cached identities for a queue after an AWS credential rejection. */
  invalidate(queueUrl: string): void {
    for (const [key, client] of this.#clients) {
      if (key.split(KEY_SEPARATOR)[0] === queueUrl) {
        client.destroy();
        this.#clients.delete(key);
      }
    }
  }

  /** Close all SDK clients during process shutdown or test teardown. */
  close(): void {
    for (const client of this.#clients.values()) client.destroy();
    this.#clients.clear();
  }

  #clientFor(config: SqsDestinationConfig): SqsClient {
    const key = clientCacheKey(config);
    const cached = this.#clients.get(key);
    if (cached) return cached;

    const parsed = parseSqsQueueUrl(config.queueUrl);
    const client = this.#createClient(
      this.#awsClientConfig({
        region: parsed?.region,
        targetHost: sqsHostFor(config.queueUrl),
        // The delivery ladder already counts attempts; SDK retries would make
        // one recorded attempt perform several real calls.
        disableSdkRetries: true,
        ...(config.roleArn
          ? {
              assumeRole: {
                roleArn: config.roleArn,
                externalId: config.externalId,
                sessionName: "langwatch-webhooks",
              },
            }
          : {}),
        staticCredentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      }),
    );
    this.#clients.set(key, client);
    return client;
  }
}

const KEY_SEPARATOR = "\u0000";

function clientCacheKey(config: SqsDestinationConfig): string {
  return [
    config.queueUrl,
    config.roleArn ?? "",
    config.externalId ?? "",
    config.accessKeyId ?? "",
    config.secretAccessKey ? createHash("sha256").update(config.secretAccessKey).digest("hex") : "",
  ].join(KEY_SEPARATOR);
}
