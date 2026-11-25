// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { AwsClientConfiguration, pinnedHostsConfig } from "@langwatch/aws-client";
import { createSsrfUrlValidator, type SsrfUrlValidator } from "@langwatch/egress";

import type { GovernanceEgressPolicy } from "../http/http.governance-http.channel.ts";
import type {
  SecurityLakeQueue,
  SecurityLakeQueueMessage,
  SecurityLakeQueueTarget,
} from "../security-lake-queue.channel.ts";

/** SQS hands out at most ten messages per receive. */
const SQS_RECEIVE_MAX = 10;
/** Short wait, so an empty queue ends the run instead of holding it. */
const WAIT_TIME_SECONDS = 1;

const AWS_SQS_HOST = /^(?:sqs\.[a-z0-9-]+|[a-z0-9-]+\.queue|queue)\.amazonaws\.com(?:\.cn)?$/;

/** True for AWS's own SQS hosts: regional, legacy regional and global queue URLs. */
export function isAwsSqsHost(host: string): boolean {
  return AWS_SQS_HOST.test(host.toLowerCase());
}

/** The subscriber queue, read with the source's own credentials, its host judged by the egress fence. */
export class SqsSecurityLakeQueueChannel implements SecurityLakeQueue {
  // The source's queue is reached directly, like its bucket, never through the outbound proxy.
  readonly #aws = AwsClientConfiguration.create({
    outboundProxy: { tryResolveForHost: () => undefined },
  });
  readonly #validate: SsrfUrlValidator;

  private constructor(egress: GovernanceEgressPolicy) {
    // AWS endpoints, VPC endpoints included, are named overrides; their addresses are still judged.
    this.#validate = createSsrfUrlValidator({ ...egress, allowAwsServiceHosts: true });
  }

  /** `egress` is the pull fence; an endpoint override is judged by it, cloud metadata always refused. */
  static create({ egress }: { egress?: GovernanceEgressPolicy } = {}): SqsSecurityLakeQueueChannel {
    return new SqsSecurityLakeQueueChannel(egress ?? { blockLocal: true, allowedHosts: [] });
  }

  async receive(
    input: SecurityLakeQueueTarget & { maxMessages: number },
  ): Promise<SecurityLakeQueueMessage[]> {
    return this.#withClient(input, async (client) => {
      const response = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: input.queueUrl,
          MaxNumberOfMessages: Math.min(Math.max(input.maxMessages, 1), SQS_RECEIVE_MAX),
          WaitTimeSeconds: WAIT_TIME_SECONDS,
          MessageSystemAttributeNames: ["ApproximateReceiveCount"],
        }),
        { abortSignal: input.signal },
      );
      return (response.Messages ?? []).flatMap((message) =>
        message.MessageId && message.ReceiptHandle && message.Body !== undefined
          ? [
              {
                messageId: message.MessageId,
                receiptHandle: message.ReceiptHandle,
                body: message.Body,
                receiveCount: Number(message.Attributes?.ApproximateReceiveCount ?? "1") || 1,
              },
            ]
          : [],
      );
    });
  }

  async delete(input: SecurityLakeQueueTarget & { receiptHandle: string }): Promise<void> {
    await this.#withClient(input, (client) =>
      client.send(
        new DeleteMessageCommand({ QueueUrl: input.queueUrl, ReceiptHandle: input.receiptHandle }),
        { abortSignal: input.signal },
      ),
    );
  }

  async changeVisibility(
    input: SecurityLakeQueueTarget & { receiptHandle: string; visibilityTimeoutSeconds: number },
  ): Promise<void> {
    await this.#withClient(input, (client) =>
      client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: input.queueUrl,
          ReceiptHandle: input.receiptHandle,
          VisibilityTimeout: input.visibilityTimeoutSeconds,
        }),
        { abortSignal: input.signal },
      ),
    );
  }

  async probe(input: SecurityLakeQueueTarget): Promise<{ waiting: number; inFlight: number }> {
    return this.#withClient(input, async (client) => {
      const response = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: input.queueUrl,
          AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
        }),
        { abortSignal: input.signal },
      );
      return {
        waiting: Number(response.Attributes?.ApproximateNumberOfMessages ?? "0") || 0,
        inFlight: Number(response.Attributes?.ApproximateNumberOfMessagesNotVisible ?? "0") || 0,
      };
    });
  }

  async #withClient<T>(
    input: SecurityLakeQueueTarget,
    operation: (client: SQSClient) => Promise<T>,
  ): Promise<T> {
    const target = input.endpoint ?? `https://sqs.${input.region}.amazonaws.com/`;
    // The regional endpoint is ours; only a customer-supplied host is judged by the fence.
    const validated = input.endpoint === undefined ? [] : [await this.#validate(target)];
    // The SDK may send to the queue URL's own host, so a host other than the target is judged too.
    const queueHost = new URL(input.queueUrl).host;
    if (queueHost !== new URL(target).host && !isAwsSqsHost(queueHost)) {
      validated.push(await this.#validate(input.queueUrl));
    }
    const { accessKeyId, secretAccessKey, sessionToken, assumeRole } = input.credentials;
    const config = this.#aws.build({
      region: input.region,
      endpoint: input.endpoint,
      targetHost: new URL(target).host,
      staticCredentials: { accessKeyId, secretAccessKey, sessionToken },
      assumeRole: assumeRole ?? null,
      requireStatic: true,
    });
    const pinned = pinnedHostsConfig(validated);
    const client = new SQSClient({ ...config, ...pinned });
    try {
      return await operation(client);
    } finally {
      client.destroy();
    }
  }
}
