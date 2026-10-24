/**
 * The function one project's studio engine runs on: created where there is
 * none, and brought up to this deployment's configuration where there is.
 *
 * @see modules/workflow/specs/studio-lambda-stream.feature
 */
import {
  CreateFunctionCommand,
  TagResourceCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import { describe, expect, it } from "vitest";

import {
  buildStudioLambdaEnvironment,
  type StudioLambdaConfig,
} from "../../rules/nlp-lambda-config.rules.ts";
import { AwsNlpLambdaArnResolverChannel } from "../aws.nlp-lambda-arn-resolver.channel.ts";

const ARN = "arn:aws:lambda:eu-central-1:123:function:langwatch_nlp-project-1";

const CONFIG: StudioLambdaConfig = {
  region: "eu-central-1",
  credentials: { kind: "static", accessKeyId: "key", secretAccessKey: "secret" },
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
  /** What UpdateFunctionConfiguration rejects with, when AWS refuses it. */
  rejectUpdateWith?: Error;
  /** What TagResource rejects with, when AWS refuses it. */
  rejectTagWith?: Error;
  config?: StudioLambdaConfig;
}) {
  const sent: Sent[] = [];
  let read = 0;
  const lambda = {
    send: (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      if (command instanceof CreateFunctionCommand) return Promise.resolve(READY);
      if (command instanceof UpdateFunctionCodeCommand) return Promise.resolve(READY);
      if (command instanceof TagResourceCommand) {
        return options.rejectTagWith ? Promise.reject(options.rejectTagWith) : Promise.resolve({});
      }
      if (command instanceof UpdateFunctionConfigurationCommand) {
        return options.rejectUpdateWith
          ? Promise.reject(options.rejectUpdateWith)
          : Promise.resolve(READY);
      }

      const answer = options.reads[Math.min(read, options.reads.length - 1)];
      read += 1;
      if (answer instanceof Error) return Promise.reject(answer);

      return Promise.resolve(answer);
    },
  } as never;
  const logs = { send: () => Promise.resolve({}) } as never;

  return {
    sent,
    subject: AwsNlpLambdaArnResolverChannel.create({
      lambda,
      logs,
      config: options.config ?? CONFIG,
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

      expect(arn.arn).toBe(ARN);
      const created = sent.find((call) => call.name === "CreateFunctionCommand");
      if (!created) throw new Error("expected CreateFunctionCommand");
      expect(created.input).toMatchObject({
        FunctionName: "langwatch_nlp-project-1",
        Role: CONFIG.roleArn,
        Code: { ImageUri: CONFIG.imageUri },
        MemorySize: 2048,
        Timeout: 900,
        VpcConfig: { SubnetIds: ["subnet-1"], SecurityGroupIds: ["sg-1"] },
      });
      expect(
        (created.input.Environment as { Variables: Record<string, string> }).Variables,
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
      if (!reconciled) throw new Error("expected UpdateFunctionConfigurationCommand");
      expect(
        (reconciled.input.Environment as { Variables: Record<string, string> }).Variables,
      ).toMatchObject({
        SET_BY_HAND: "keep",
        STUDIO_RUNTIME: "async",
        NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS: "600",
      });
      expect(sent.some((call) => call.name === "CreateFunctionCommand")).toBe(false);
    });
  });

  describe("when the function's configuration has drifted from the deployment's", () => {
    const desired = buildStudioLambdaEnvironment(CONFIG);
    const deployed = (overrides: Record<string, unknown>) => ({
      ...READY,
      Environment: { Variables: desired },
      ...overrides,
    });
    const updates = (sent: Sent[]) =>
      sent.filter((call) => call.name === "UpdateFunctionConfigurationCommand");

    /** @scenario "A pre-existing Lambda carrying a stale env var is reconciled without clobbering unmanaged vars" */
    it("issues one update that fixes the stale variable and keeps the unmanaged one", async () => {
      const stale = deployed({
        Environment: {
          Variables: { ...desired, CACHE_BUCKET: "old-bucket", UNMANAGED: "keep-me" },
        },
      });
      const { sent, subject } = resolver({
        reads: [
          { Configuration: stale },
          { Code: { ImageUri: CONFIG.imageUri }, Configuration: stale },
          { Configuration: READY },
        ],
      });

      await subject.resolve({ projectId: "project-1" });

      expect(updates(sent)).toHaveLength(1);
      const variables = (
        updates(sent)[0]!.input.Environment as { Variables: Record<string, string> }
      ).Variables;
      expect(variables).toEqual({ ...desired, UNMANAGED: "keep-me" });
      expect(variables.CACHE_BUCKET).toBe("langwatch-nlp-cache");
    });

    /** @scenario "A Lambda still on the old 1024 MB default is raised to 2048" */
    it("raises a 1024 MB function to 2048", async () => {
      const small = deployed({ MemorySize: 1024 });
      const { sent, subject } = resolver({
        reads: [
          { Configuration: small },
          { Code: { ImageUri: CONFIG.imageUri }, Configuration: small },
          { Configuration: READY },
        ],
      });

      await subject.resolve({ projectId: "project-1" });

      expect(updates(sent)).toHaveLength(1);
      expect(updates(sent)[0]!.input).toMatchObject({ MemorySize: 2048 });
    });

    /** @scenario "No drift means no AWS write at all — the common path" */
    it("writes nothing when the environment and memory already match", async () => {
      const current = deployed({});
      const { sent, subject } = resolver({
        reads: [
          { Configuration: current },
          { Code: { ImageUri: CONFIG.imageUri }, Configuration: current },
          { Configuration: READY },
        ],
      });

      const arn = await subject.resolve({ projectId: "project-1" });

      expect(arn.arn).toBe(ARN);
      expect(updates(sent)).toHaveLength(0);
      expect(sent.some((call) => call.name === "CreateFunctionCommand")).toBe(false);
      expect(sent.some((call) => call.name === "UpdateFunctionCodeCommand")).toBe(false);
    });

    /** @scenario "The code update lands and is polled to completion before the config update is sent" */
    it("waits for the image update to finish before it sends the configuration", async () => {
      const drifted = deployed({ MemorySize: 1024 });
      const { sent, subject } = resolver({
        reads: [
          { Configuration: drifted },
          { Code: { ImageUri: "registry/nlp:v8" }, Configuration: drifted },
          { Configuration: { ...READY, LastUpdateStatus: "InProgress" } },
          { Configuration: READY },
        ],
      });

      await subject.resolve({ projectId: "project-1" });

      const names = sent.map((call) => call.name);
      const code = names.indexOf("UpdateFunctionCodeCommand");
      const config = names.indexOf("UpdateFunctionConfigurationCommand");
      expect(code).toBeGreaterThanOrEqual(0);
      expect(sent[code]!.input).toMatchObject({ ImageUri: CONFIG.imageUri });
      expect(config).toBeGreaterThan(code);
      expect(names.slice(code + 1, config)).toEqual(["GetFunctionCommand", "GetFunctionCommand"]);
    });

    const drift = () => {
      const drifted = deployed({ MemorySize: 1024 });
      return [
        { Configuration: drifted },
        { Code: { ImageUri: CONFIG.imageUri }, Configuration: drifted },
        { Configuration: READY },
      ];
    };

    /** @scenario "A concurrent update makes AWS reject the reconcile but resolution still succeeds" */
    it("still answers with the ARN when AWS says an update is in progress", async () => {
      const { sent, subject } = resolver({
        reads: drift(),
        rejectUpdateWith: new Error("An update is in progress for resource"),
      });

      const arn = await subject.resolve({ projectId: "project-1" });

      expect(arn.arn).toBe(ARN);
      expect(updates(sent)).toHaveLength(1);
    });

    /** @scenario "AWS errors are matched by exception name, not message text" */
    it("recognises a ResourceConflictException by its name whatever its message says", async () => {
      class Conflict extends Error {
        override readonly name = "ResourceConflictException";
      }
      const { subject } = resolver({
        reads: drift(),
        rejectUpdateWith: new Conflict("the message is not the point"),
      });

      await expect(subject.resolve({ projectId: "project-1" })).resolves.toMatchObject({
        arn: ARN,
      });
    });

    /** @scenario "AWS errors are matched by exception name, not message text" */
    it("falls back to the message when the error carries no recognised name", async () => {
      const { subject } = resolver({
        reads: drift(),
        rejectUpdateWith: new Error("An update is in progress"),
      });

      await expect(subject.resolve({ projectId: "project-1" })).resolves.toMatchObject({
        arn: ARN,
      });
    });

    /** @scenario "AWS errors are matched by exception name, not message text" */
    it("rethrows an unrelated error", async () => {
      const { subject } = resolver({
        reads: drift(),
        rejectUpdateWith: new Error("Access denied"),
      });

      await expect(subject.resolve({ projectId: "project-1" })).rejects.toThrow("Access denied");
    });
  });
});

describe("given pods of two releases serving the same project during a rollout", () => {
  const ORDERED: StudioLambdaConfig = { ...CONFIG, imageOrder: 1_700_000_200 };
  const desired = buildStudioLambdaEnvironment(ORDERED);
  const onImage = (input: {
    image: string;
    tags?: Record<string, string>;
    tagsError?: { ErrorCode: string; Message: string };
    memory?: number;
  }) => {
    const configuration = {
      ...READY,
      MemorySize: input.memory ?? 2048,
      Environment: { Variables: desired },
    };

    return [
      { Configuration: configuration },
      {
        Code: { ImageUri: input.image },
        Configuration: configuration,
        Tags: input.tags,
        TagsError: input.tagsError,
      },
      { Configuration: READY },
    ];
  };
  const names = (sent: Sent[]) => sent.map((call) => call.name);
  const writes = (sent: Sent[]) => names(sent).filter((name) => name !== "GetFunctionCommand");

  describe("when the function was moved by a newer release", () => {
    /** @scenario "A pod on an older release leaves a function a newer release moved" */
    it("answers with the ARN and writes nothing to the function", async () => {
      const { sent, subject } = resolver({
        config: ORDERED,
        reads: onImage({
          image: "registry/nlp:v10",
          tags: { ImageOrder: "1700000300" },
          memory: 1024,
        }),
      });

      const resolution = await subject.resolve({ projectId: "project-1" });

      expect(resolution).toEqual({
        arn: ARN,
        imageUri: "registry/nlp:v10",
        imageOrder: 1700000300,
      });
      expect(writes(sent)).toEqual([]);
    });
  });

  describe("when Lambda cannot return the function's tags", () => {
    /** @scenario "A pod that cannot read the function's order leaves it alone" */
    it("writes nothing and marks the resolution unprotected", async () => {
      const { sent, subject } = resolver({
        config: ORDERED,
        reads: onImage({
          image: "registry/nlp:v10",
          tagsError: { ErrorCode: "AccessDeniedException", Message: "lambda:ListTags" },
        }),
      });

      const resolution = await subject.resolve({ projectId: "project-1" });

      expect(resolution).toEqual({
        arn: ARN,
        imageUri: CONFIG.imageUri,
        imageOrder: 1700000200,
        unprotected: true,
      });
      expect(writes(sent)).toEqual([]);
    });
  });

  describe("when Lambda refuses to record the pod's order", () => {
    /** @scenario "A pod that cannot record its order does not move the image" */
    it("leaves the image and configuration as they are", async () => {
      const { sent, subject } = resolver({
        config: ORDERED,
        reads: onImage({ image: "registry/nlp:v8", memory: 1024 }),
        rejectTagWith: new Error("not authorized to perform lambda:TagResource"),
      });

      const resolution = await subject.resolve({ projectId: "project-1" });

      expect(resolution).toMatchObject({ arn: ARN, imageUri: CONFIG.imageUri, unprotected: true });
      expect(writes(sent)).toEqual(["TagResourceCommand"]);
    });
  });

  describe("when the function runs an older release's image", () => {
    /** @scenario "A pod on a newer release upgrades an older or untagged function" */
    it("tags its own order before it moves the image", async () => {
      const { sent, subject } = resolver({
        config: ORDERED,
        reads: onImage({ image: "registry/nlp:v8", tags: { ImageOrder: "1700000100" } }),
      });

      await subject.resolve({ projectId: "project-1" });

      expect(writes(sent)).toEqual(["TagResourceCommand", "UpdateFunctionCodeCommand"]);
      const tagged = sent.find((call) => call.name === "TagResourceCommand");
      expect(tagged?.input).toEqual({ Resource: ARN, Tags: { ImageOrder: "1700000200" } });
      const updated = sent.find((call) => call.name === "UpdateFunctionCodeCommand");
      expect(updated?.input).toMatchObject({ ImageUri: CONFIG.imageUri });
    });

    /** @scenario "A pod on a newer release upgrades an older or untagged function" */
    it("treats a function with no recorded order as older", async () => {
      const { sent, subject } = resolver({
        config: ORDERED,
        reads: onImage({ image: "registry/nlp:v8" }),
      });

      await subject.resolve({ projectId: "project-1" });

      expect(writes(sent)).toEqual(["TagResourceCommand", "UpdateFunctionCodeCommand"]);
    });
  });

  describe("when the function carries this pod's own order on another image", () => {
    /** @scenario "A pod on the same release converges the function as before" */
    it("moves the image without retagging", async () => {
      const { sent, subject } = resolver({
        config: ORDERED,
        reads: onImage({ image: "registry/nlp:v8", tags: { ImageOrder: "1700000200" } }),
      });

      await subject.resolve({ projectId: "project-1" });

      expect(writes(sent)).toEqual(["UpdateFunctionCodeCommand"]);
    });
  });

  describe("when the fleet names no image order", () => {
    /** @scenario "A fleet that names no image order converges as before" */
    it("moves the image whatever the function records, and tags nothing", async () => {
      const { sent, subject } = resolver({
        reads: onImage({ image: "registry/nlp:v10", tags: { ImageOrder: "1700000300" } }),
      });

      await subject.resolve({ projectId: "project-1" });

      expect(writes(sent)).toEqual(["UpdateFunctionCodeCommand"]);
    });
  });

  describe("when the project has no function yet", () => {
    /** @scenario "A newly created function records the pod's image order" */
    it("creates it tagged with the pod's order", async () => {
      const { sent, subject } = resolver({
        config: ORDERED,
        reads: [new NotFound(), { Configuration: READY }],
      });

      await subject.resolve({ projectId: "project-1" });

      const created = sent.find((call) => call.name === "CreateFunctionCommand");
      expect(created?.input.Tags).toEqual({
        Project: "langwatch",
        Type: "optimization-studio",
        ImageOrder: "1700000200",
      });
    });
  });
});
