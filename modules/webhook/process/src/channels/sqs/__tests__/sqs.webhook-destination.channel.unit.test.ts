import { SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  AwsClientConfiguration,
  OutboundProxyResolver,
  type AwsClientConfig,
  type AwsClientConfigInput,
} from "@langwatch/aws-client";
import { describe, expect, it, vi } from "vitest";

import type { SqsDestinationConfig } from "../../webhook-destination.channel.ts";
import {
  SqsWebhookDestinationChannel,
  type SqsClientFactory,
} from "../sqs.webhook-destination.channel.ts";

const QUEUE_URL = "https://sqs.eu-central-1.amazonaws.com/381491922238/webhooks";

class NoProxy extends OutboundProxyResolver {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

const configuration = AwsClientConfiguration.create({ outboundProxy: new NoProxy() });
const resolvedInputs: AwsClientConfigInput[] = [];
const awsClientConfig = (input: AwsClientConfigInput): AwsClientConfig => {
  resolvedInputs.push(input);
  return configuration.build(input);
};

class FakeSqsClient {
  readonly send = vi.fn(async (command: SendMessageCommand) => ({
    MessageId: command.input.MessageBody,
  }));
  readonly destroy = vi.fn();
}

function clientFactory(): { factory: SqsClientFactory; clients: FakeSqsClient[] } {
  const clients: FakeSqsClient[] = [];
  const factory: SqsClientFactory = () => {
    const client = new FakeSqsClient();
    clients.push(client);
    return client;
  };

  return { factory, clients };
}

function channel(factory: SqsClientFactory): SqsWebhookDestinationChannel {
  return SqsWebhookDestinationChannel.create({ awsClientConfig, createClient: factory });
}

describe("SqsWebhookDestinationChannel", () => {
  it("reuses a client for the same queue and credentials", async () => {
    const { factory, clients } = clientFactory();
    const subject = channel(factory);
    const config: SqsDestinationConfig = {
      queueUrl: QUEUE_URL,
      accessKeyId: "AKIA1",
      secretAccessKey: "secret",
    };

    await subject.send({ config, body: "first", attributes: {} });
    await subject.send({ config: { ...config }, body: "second", attributes: {} });

    expect(clients).toHaveLength(1);
    expect(clients[0]?.send).toHaveBeenNthCalledWith(1, expect.any(SendMessageCommand));
    expect(clients[0]?.send).toHaveBeenNthCalledWith(2, expect.any(SendMessageCommand));
    subject.close();
  });

  it("rebuilds a client when credentials rotate", async () => {
    const { factory, clients } = clientFactory();
    const subject = channel(factory);
    const first: SqsDestinationConfig = {
      queueUrl: QUEUE_URL,
      accessKeyId: "AKIA1",
      secretAccessKey: "secret",
    };
    const rotated: SqsDestinationConfig = {
      queueUrl: QUEUE_URL,
      accessKeyId: "AKIA1",
      secretAccessKey: "rotated",
    };

    await subject.send({ config: first, body: "first", attributes: {} });
    await subject.send({ config: rotated, body: "rotated", attributes: {} });

    expect(clients).toHaveLength(2);
    subject.close();
  });

  it("takes the region from the queue URL and disables SDK retries", async () => {
    const { factory } = clientFactory();
    const subject = channel(factory);
    await subject.send({
      config: {
        queueUrl: QUEUE_URL,
        accessKeyId: "AKIA1",
        secretAccessKey: "secret",
      },
      body: "body",
      attributes: {},
    });

    expect(resolvedInputs.at(-1)).toMatchObject({
      region: "eu-central-1",
      disableSdkRetries: true,
      targetHost: "sqs.eu-central-1.amazonaws.com",
    });
    subject.close();
  });

  it("invalidates every cached identity for a queue", async () => {
    const { factory, clients } = clientFactory();
    const subject = channel(factory);
    const first: SqsDestinationConfig = {
      queueUrl: QUEUE_URL,
      accessKeyId: "AKIA1",
      secretAccessKey: "secret",
    };
    const second: SqsDestinationConfig = {
      queueUrl: QUEUE_URL,
      accessKeyId: "AKIA2",
      secretAccessKey: "secret",
    };
    await subject.send({ config: first, body: "first", attributes: {} });
    await subject.send({ config: second, body: "second", attributes: {} });
    subject.invalidate(QUEUE_URL);

    expect(clients).toHaveLength(2);
    expect(clients[0]?.destroy).toHaveBeenCalledOnce();
    expect(clients[1]?.destroy).toHaveBeenCalledOnce();
    await subject.send({ config: first, body: "recreated", attributes: {} });
    expect(clients).toHaveLength(3);
    subject.close();
  });
});
