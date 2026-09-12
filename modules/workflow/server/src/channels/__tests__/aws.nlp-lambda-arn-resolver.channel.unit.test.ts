/**
 * The function one project's studio engine runs on: created where there is
 * none, and brought up to this deployment's configuration where there is.
 *
 * @see modules/workflow/specs/studio-lambda-stream.feature
 */
import type { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import {
  CreateFunctionCommand,
  UpdateFunctionConfigurationCommand,
  type LambdaClient,
} from "@aws-sdk/client-lambda";
import { describe, expect, it } from "vitest";
import { AwsNlpLambdaArnResolverAdapter } from "../../adapters/aws.nlp-lambda-arn-resolver.adapter.ts";
import type { StudioLambdaConfig } from "../../rules/nlp-lambda-config.rules.ts";

const ARN = "arn:aws:lambda:eu-central-1:123:function:langwatch_nlp-project-1";

const CONFIG: StudioLambdaConfig = {
  region: "eu-central-1",
  accessKeyId: "key",
  secretAccessKey: "secret",
  roleArn: "arn:aws:iam::123:role/nlp",
  imageUri: "registry/nlp:v9",
  cacheBucket: "langwatch-nlp-cache",
  subnetIds: ["subnet-1"],
  securityGroupIds: ["sg-1"],
  langwatchEndpoint: "https://app.test",
  codeBlockTimeoutSeconds: 600,
  stagingThresholdBytes: 5_000_000,
  stagingTtlSeconds: 600,
};

const READY = {
  FunctionArn: ARN,
  State: "Active",
  LastUpdateStatus: "Successful",
  MemorySize: 2048,
  Timeout: 900,
};

class NotFound extends Error {
  override readonly name = "ResourceNotFoundException";
}

type Sent = { name: string; input: Record<string, unknown> };

function resolver(options: {
  /** Answers each GetFunction in turn; the last answer repeats. */
  reads: readonly unknown[];
}) {
  const sent: Sent[] = [];
  let read = 0;
  const lambda = {
    send: (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      if (command instanceof CreateFunctionCommand) return Promise.resolve(READY);
      if (command instanceof UpdateFunctionConfigurationCommand) return Promise.resolve(READY);

      const answer = options.reads[Math.min(read, options.reads.length - 1)];
      read += 1;
      if (answer instanceof Error) return Promise.reject(answer);

      return Promise.resolve(answer);
    },
  } as unknown as LambdaClient;
  const logs = { send: () => Promise.resolve({}) } as unknown as CloudWatchLogsClient;

  return {
    sent,
    subject: AwsNlpLambdaArnResolverAdapter.create({
      lambda,
      logs,
      config: CONFIG,
      wait: () => Promise.resolve(),
    }),
  };
}

describe("given a project whose studio engine needs a function", () => {
  describe("when the account holds none for it", () => {
    /** @scenario "A project without a function gets one created" */
    it("creates it from the deployment's image, network and environment", async () => {
      const { sent, subject } = resolver({
        reads: [new NotFound(), { Configuration: READY }],
      });

      const arn = await subject.resolve({ projectId: "project-1" });

      expect(arn).toBe(ARN);
      const created = sent.find((call) => call.name === "CreateFunctionCommand");
      expect(created?.input).toMatchObject({
        FunctionName: "langwatch_nlp-project-1",
        Role: CONFIG.roleArn,
        Code: { ImageUri: CONFIG.imageUri },
        MemorySize: 2048,
        Timeout: 900,
        VpcConfig: { SubnetIds: ["subnet-1"], SecurityGroupIds: ["sg-1"] },
      });
      expect(
        (created?.input.Environment as { Variables: Record<string, string> }).Variables,
      ).toMatchObject({
        LANGWATCH_ENDPOINT: "https://app.test",
        AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
        CACHE_BUCKET: "langwatch-nlp-cache",
      });
    });
  });

  describe("when the account holds one born with a different configuration", () => {
    /** @scenario "An existing function is brought up to the deployment's configuration" */
    it("reconciles its environment without clobbering what it did not set", async () => {
      const { sent, subject } = resolver({
        reads: [
          { Configuration: { ...READY, Environment: { Variables: { SET_BY_HAND: "keep" } } } },
          {
            Code: { ImageUri: CONFIG.imageUri },
            Configuration: { ...READY, Environment: { Variables: { SET_BY_HAND: "keep" } } },
          },
          { Configuration: READY },
        ],
      });

      await subject.resolve({ projectId: "project-1" });

      const reconciled = sent.find((call) => call.name === "UpdateFunctionConfigurationCommand");
      expect(
        (reconciled?.input.Environment as { Variables: Record<string, string> }).Variables,
      ).toMatchObject({
        SET_BY_HAND: "keep",
        STUDIO_RUNTIME: "async",
        NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS: "600",
      });
      expect(sent.some((call) => call.name === "CreateFunctionCommand")).toBe(false);
    });
  });
});
