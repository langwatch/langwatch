import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildMock, closeMock, createMock } = vi.hoisted(() => {
  const buildMock = vi.fn(
    (input: {
      region: string;
      staticCredentials: { accessKeyId: string; secretAccessKey: string };
      targetHost: string;
    }) => ({
      credentials: { ...input.staticCredentials },
      region: input.region,
      requestHandler: {
        destroy() {},
        handle() {
          return Promise.resolve();
        },
        metadata: { handlerProtocol: "http/1.1" },
      },
    }),
  );
  const closeMock = vi.fn(() => Promise.resolve());
  const createMock = vi.fn(() => ({ build: buildMock, close: closeMock }));

  return { buildMock, closeMock, createMock };
});

vi.mock("@langwatch/aws-client", () => ({
  AwsClientConfiguration: { create: createMock },
  OutboundProxyResolverPort: class OutboundProxyResolverPort {},
}));

import { AppNlpLambdaAwsClientAdapter } from "../nlp-lambda.aws-client.adapter";
import { AppAwsClientConfiguration } from "~/runtime/app/aws-client.composition";
import type { NlpLambdaDeploymentConfig } from "~/runtime/api/nlp-lambda";

const deployment = {
  AWS_ACCESS_KEY_ID: "access-key",
  AWS_SECRET_ACCESS_KEY: "secret-key",
  AWS_REGION: "eu-central-1",
  cache_bucket: "nlp-cache",
  image_uri: "registry.example/nlp:latest",
  role_arn: "arn:aws:iam::123:role/nlp",
  security_group_ids: [],
  subnet_ids: [],
} satisfies NlpLambdaDeploymentConfig;

function createAdapter(input: { deployment?: NlpLambdaDeploymentConfig } = {}) {
  return AppNlpLambdaAwsClientAdapter.create({
    aws: AppAwsClientConfiguration.create({}),
    deployment: input.deployment ?? deployment,
  });
}

function expectAwsClientBuild(call: number, region: string, targetHost: string): void {
  expect(buildMock).toHaveBeenNthCalledWith(
    call,
    expect.objectContaining({
      region,
      staticCredentials: expect.objectContaining({
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
      }),
      targetHost,
    }),
  );
}

describe("NLP Lambda AWS client adapter", () => {
  beforeEach(() => {
    buildMock.mockClear();
    closeMock.mockClear();
    createMock.mockClear();
  });

  it("uses one Lambda and Logs client with the composed region and static credentials", async () => {
    const adapter = createAdapter();

    const lambda = adapter.createLambdaClient();
    const logs = adapter.createLogsClient();

    expect(adapter.createLambdaClient()).toBe(lambda);
    expect(adapter.createLogsClient()).toBe(logs);
    expect(await lambda.config.region()).toBe("eu-central-1");
    expect(await lambda.config.credentials()).toMatchObject({
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
    });
    expect(await lambda.config.maxAttempts()).toBe(6);
    expectAwsClientBuild(1, "eu-central-1", "lambda.eu-central-1.amazonaws.com");
    expectAwsClientBuild(2, "eu-central-1", "logs.eu-central-1.amazonaws.com");
  });

  it("resolves China partition service hosts through the composed proxy policy", () => {
    const adapter = createAdapter({
      deployment: { ...deployment, AWS_REGION: "cn-north-1" },
    });

    adapter.createLambdaClient();
    adapter.createLogsClient();

    expectAwsClientBuild(1, "cn-north-1", "lambda.cn-north-1.amazonaws.com.cn");
    expectAwsClientBuild(2, "cn-north-1", "logs.cn-north-1.amazonaws.com.cn");
  });

  it("keeps GovCloud service hosts in the standard AWS partition", () => {
    const adapter = createAdapter({
      deployment: { ...deployment, AWS_REGION: "us-gov-west-1" },
    });

    adapter.createLambdaClient();
    adapter.createLogsClient();

    expectAwsClientBuild(1, "us-gov-west-1", "lambda.us-gov-west-1.amazonaws.com");
    expectAwsClientBuild(2, "us-gov-west-1", "logs.us-gov-west-1.amazonaws.com");
  });

  it("destroys both client-local SDK instances once before rejecting reuse", async () => {
    const adapter = createAdapter();
    const lambda = adapter.createLambdaClient();
    const logs = adapter.createLogsClient();
    const destroyLambda = vi.spyOn(lambda, "destroy");
    const destroyLogs = vi.spyOn(logs, "destroy");

    const close = adapter.close();

    expect(adapter.close()).toBe(close);

    await close;

    expect(destroyLambda).toHaveBeenCalledOnce();
    expect(destroyLogs).toHaveBeenCalledOnce();
    expect(() => adapter.createLambdaClient()).toThrow("are closed");
  });
});
