/**
 * @vitest-environment node
 * @see specs/nlp-go/studio-lambda-cache.feature
 */
import { GetFunctionCommand, UpdateFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import { describe, expect, it, vi } from "vitest";

import type { NlpLambdaArnCache } from "../../app/workflow.app.ts";
import { AwsNlpLambdaArnResolverChannel } from "../../channels/aws.nlp-lambda-arn-resolver.channel.ts";
import type { NlpLambdaArnResolver } from "../../channels/nlp-lambda.channel.ts";
import {
  buildStudioLambdaConfig,
  buildStudioLambdaEnvironment,
  studioLambdaConfigFingerprint,
  type StudioLambdaConfig,
} from "../../rules/nlp-lambda-config.rules.ts";
import {
  NLP_LAMBDA_ARN_CACHE_TTL_SECONDS,
  NlpLambdaRuntimeService,
} from "../nlp-lambda-runtime.service.ts";

const IMAGE = "ecr/foo:v1";
const NEXT_IMAGE = "ecr/foo:v2";
const PROJECT = "projectA";
const ARN = "arn:aws:lambda:eu-central-1:1:function:langwatch_nlp-projectA";
const FINGERPRINT = "fingerprint-a";

/** A store shared by every runtime built from it, as Redis is by every pod. */
class SharedCache implements NlpLambdaArnCache {
  readonly entries = new Map<string, { value: string; ttlSeconds: number }>();
  readonly reads: string[] = [];
  readonly deleted: string[] = [];
  failReads = false;

  async find(key: string): Promise<string | null> {
    this.reads.push(key);
    if (this.failReads) throw new Error("Redis is unavailable");
    return this.entries.get(key)?.value ?? null;
  }

  async set(input: { key: string; value: string; ttlSeconds: number }): Promise<void> {
    this.entries.set(input.key, { value: input.value, ttlSeconds: input.ttlSeconds });
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.entries.delete(key);
  }
}

function awsResolver(arn: string = ARN) {
  const resolve = vi.fn(async () => arn);
  const resolver = new (class implements NlpLambdaArnResolver {
    resolve = resolve;
  })();
  return { resolver, resolve };
}

function runtime(options: {
  cache: SharedCache;
  resolver: NlpLambdaArnResolver;
  imageUri?: string;
  configFingerprint?: string;
}) {
  return NlpLambdaRuntimeService.create({
    cache: options.cache,
    resolver: options.resolver,
    imageUri: options.imageUri ?? IMAGE,
    configFingerprint: options.configFingerprint ?? FINGERPRINT,
  });
}

/** The studio deployment under one code-block ceiling, as the app assembles it. */
function deploymentWithCeiling(seconds: string): StudioLambdaConfig {
  return buildStudioLambdaConfig({
    fields: {
      region: "eu-central-1",
      accessKeyId: "key",
      secretAccessKey: "secret",
      roleArn: "arn:aws:iam::1:role/nlp",
      imageUri: IMAGE,
      cacheBucket: "langwatch-nlp-cache",
      subnetIds: ["subnet-1"],
      securityGroupIds: ["sg-1"],
    },
    langwatchEndpoint: "https://app.test",
    codeBlockTimeoutRawValue: seconds,
    stagingThresholdBytesRawValue: undefined,
    stagingTtlSecondsRawValue: undefined,
  });
}

/** An account holding projectA's function as `deployed` configured it; records what is sent. */
function awsAccount(deployed: StudioLambdaConfig) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const configuration = {
    FunctionArn: ARN,
    State: "Active",
    LastUpdateStatus: "Successful",
    MemorySize: 2048,
    Timeout: 900,
    Environment: { Variables: buildStudioLambdaEnvironment(deployed) },
  };
  const lambda = {
    send: (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      if (command instanceof GetFunctionCommand) {
        return Promise.resolve({ Configuration: configuration, Code: { ImageUri: IMAGE } });
      }

      return Promise.resolve(configuration);
    },
  } as never;
  const logs = { send: () => Promise.resolve({}) } as never;

  return {
    sent,
    resolverFor: (config: StudioLambdaConfig) =>
      AwsNlpLambdaArnResolverChannel.create({
        lambda,
        logs,
        config,
        wait: () => Promise.resolve(),
      }),
  };
}

describe("the per-project NLP Lambda runtime", () => {
  describe("when a project resolves for the first time", () => {
    /** @scenario "A successful resolution is shared for ten minutes" */
    it("shares the ARN and the image it was resolved under, for ten minutes", async () => {
      const cache = new SharedCache();
      const { resolver } = awsResolver();

      const arn = await runtime({ cache, resolver }).resolveArn(PROJECT);

      expect(arn).toBe(ARN);
      const stored = cache.entries.get("lambda_arn:projectA");
      expect(stored?.ttlSeconds).toBe(NLP_LAMBDA_ARN_CACHE_TTL_SECONDS);
      expect(JSON.parse(stored!.value)).toEqual({
        arn: ARN,
        imageUri: IMAGE,
        configFingerprint: FINGERPRINT,
      });
    });

    /** @scenario "A successful resolution is shared for ten minutes" */
    it("answers later calls without going back to AWS", async () => {
      const cache = new SharedCache();
      const { resolver, resolve } = awsResolver();
      const engine = runtime({ cache, resolver });

      await engine.resolveArn(PROJECT);
      await engine.resolveArn(PROJECT);
      await engine.resolveArn(PROJECT);

      expect(resolve).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A resolved function is shared across every pod through Redis" */
    /** @scenario "A successful resolution is shared for ten minutes" */
    it("warms every other pod, so a fresh runtime resolves nothing", async () => {
      const cache = new SharedCache();
      const first = awsResolver();
      const second = awsResolver();

      await runtime({ cache, resolver: first.resolver }).resolveArn(PROJECT);
      const arn = await runtime({ cache, resolver: second.resolver }).resolveArn(PROJECT);

      expect(arn).toBe(ARN);
      expect(second.resolve).not.toHaveBeenCalled();
    });
  });

  describe("when the same project is asked for again under an unchanged image", () => {
    /** @scenario "An unchanged desired configuration keeps serving from cache, no spurious invalidation" */
    it("returns the cached ARN without resolving again or dropping the entry", async () => {
      const cache = new SharedCache();
      const { resolver, resolve } = awsResolver();
      await runtime({ cache, resolver }).resolveArn(PROJECT);
      const before = cache.entries.get("lambda_arn:projectA")?.value;

      const again = await runtime({ cache, resolver }).resolveArn(PROJECT);

      expect(again).toBe(ARN);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(cache.deleted).toEqual([]);
      expect(cache.entries.get("lambda_arn:projectA")?.value).toBe(before);
    });
  });

  describe("when two projects resolve", () => {
    /** @scenario "Different projects do not share cache slots" */
    it("files each under its own key and never answers one with the other's", async () => {
      const cache = new SharedCache();
      const resolve = vi.fn(
        async (input: { projectId: string; imageUri: string }) =>
          `arn:aws:lambda:eu-central-1:1:function:langwatch_nlp-${input.projectId}`,
      );
      const resolver = new (class implements NlpLambdaArnResolver {
        resolve = resolve;
      })();
      const engine = runtime({ cache, resolver });

      const arnA = await engine.resolveArn("projectA");
      const arnB = await engine.resolveArn("projectB");
      const arnAAgain = await engine.resolveArn("projectA");

      expect(arnA).not.toBe(arnB);
      expect(arnAAgain).toBe(arnA);
      expect([...cache.entries.keys()].toSorted()).toEqual([
        "lambda_arn:projectA",
        "lambda_arn:projectB",
      ]);
      expect(JSON.parse(cache.entries.get("lambda_arn:projectA")!.value).arn).toBe(arnA);
      expect(JSON.parse(cache.entries.get("lambda_arn:projectB")!.value).arn).toBe(arnB);
      expect(resolve).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a burst of callers miss together on one pod", () => {
    /** @scenario "A concurrent local miss has one AWS resolution" */
    it("collapses them onto one resolution and answers all of them with it", async () => {
      const cache = new SharedCache();
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const resolve = vi.fn(async () => {
        await gate;
        return ARN;
      });
      const resolver = new (class implements NlpLambdaArnResolver {
        resolve = resolve;
      })();
      const engine = runtime({ cache, resolver });

      const callers = Array.from({ length: 25 }, () => engine.resolveArn(PROJECT));
      release!();
      const answers = await Promise.all(callers);

      expect(new Set(answers)).toEqual(new Set([ARN]));
      expect(resolve).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the shared cache cannot be trusted", () => {
    /** @scenario "Cache failures and malformed entries fall back to AWS" */
    it("resolves from AWS when the cache read fails", async () => {
      const cache = new SharedCache();
      cache.failReads = true;
      const { resolver, resolve } = awsResolver();

      const arn = await runtime({ cache, resolver }).resolveArn(PROJECT);

      expect(arn).toBe(ARN);
      expect(resolve).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Cache failures and malformed entries fall back to AWS" */
    it("resolves from AWS when the stored entry is malformed", async () => {
      const cache = new SharedCache();
      await cache.set({ key: "lambda_arn:projectA", value: "{not json", ttlSeconds: 600 });
      const { resolver, resolve } = awsResolver();

      const arn = await runtime({ cache, resolver }).resolveArn(PROJECT);

      expect(arn).toBe(ARN);
      expect(resolve).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Cache failures and malformed entries fall back to AWS" */
    it("shares nothing when the AWS resolution itself fails", async () => {
      const cache = new SharedCache();
      const resolve = vi.fn(async () => {
        throw new Error("Rate Exceeded.");
      });
      const resolver = new (class implements NlpLambdaArnResolver {
        resolve = resolve as never;
      })();
      const engine = runtime({ cache, resolver });

      await expect(engine.resolveArn(PROJECT)).rejects.toThrow("Rate Exceeded.");

      expect(cache.entries.size).toBe(0);
      // A refusal that stuck would be pinned cluster-wide for the whole window;
      // the next caller must be free to try again.
      await expect(engine.resolveArn(PROJECT)).rejects.toThrow("Rate Exceeded.");
      expect(resolve).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the deployment image changes", () => {
    /** @scenario "An image change deletes a stale cached ARN before refresh" */
    it("drops the stale entry and shares the refreshed one under the new image", async () => {
      const cache = new SharedCache();
      await runtime({ cache, resolver: awsResolver().resolver }).resolveArn(PROJECT);
      const refreshedArn = `${ARN}-v2`;
      const { resolver, resolve } = awsResolver(refreshedArn);

      const arn = await runtime({ cache, resolver, imageUri: NEXT_IMAGE }).resolveArn(PROJECT);

      expect(cache.deleted).toEqual(["lambda_arn:projectA"]);
      expect(arn).toBe(refreshedArn);
      expect(resolve).toHaveBeenCalledWith({ projectId: PROJECT, imageUri: NEXT_IMAGE });
      expect(JSON.parse(cache.entries.get("lambda_arn:projectA")!.value)).toEqual({
        arn: refreshedArn,
        imageUri: NEXT_IMAGE,
        configFingerprint: FINGERPRINT,
      });
    });
  });

  describe("when a rollout changes only the function's configuration", () => {
    /** @scenario "A config-only rollout (timeout change, no new image) invalidates the cache and reconciles" */
    it("drops the entry and reconciles the raised ceiling at once, under the same image", async () => {
      const cache = new SharedCache();
      const before = deploymentWithCeiling("120");
      const after = deploymentWithCeiling("300");
      const account = awsAccount(before);
      await NlpLambdaRuntimeService.create({
        cache,
        resolver: account.resolverFor(before),
        imageUri: IMAGE,
        configFingerprint: studioLambdaConfigFingerprint(before),
      }).resolveArn(PROJECT);
      account.sent.length = 0;

      const arn = await NlpLambdaRuntimeService.create({
        cache,
        resolver: account.resolverFor(after),
        imageUri: IMAGE,
        configFingerprint: studioLambdaConfigFingerprint(after),
      }).resolveArn(PROJECT);

      expect(arn).toBe(ARN);
      expect(studioLambdaConfigFingerprint(after)).not.toBe(studioLambdaConfigFingerprint(before));
      expect(cache.deleted).toEqual(["lambda_arn:projectA"]);
      const update = account.sent.find(
        (call) => call.name === UpdateFunctionConfigurationCommand.name,
      );
      expect(update?.input).toMatchObject({
        Environment: { Variables: { NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS: "300" } },
      });
      expect(JSON.parse(cache.entries.get("lambda_arn:projectA")!.value)).toMatchObject({
        imageUri: IMAGE,
        configFingerprint: studioLambdaConfigFingerprint(after),
      });
    });

    /** @scenario "A config-only rollout (timeout change, no new image) invalidates the cache and reconciles" */
    it("reads an entry written before the fingerprint existed as a miss", async () => {
      const cache = new SharedCache();
      await cache.set({
        key: "lambda_arn:projectA",
        value: JSON.stringify({ arn: ARN, imageUri: IMAGE }),
        ttlSeconds: 600,
      });
      const { resolver, resolve } = awsResolver();

      await runtime({ cache, resolver }).resolveArn(PROJECT);

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(JSON.parse(cache.entries.get("lambda_arn:projectA")!.value)).toMatchObject({
        configFingerprint: FINGERPRINT,
      });
    });
  });

  describe("when the configuration is unchanged", () => {
    /** @scenario "An unchanged desired configuration keeps serving from cache, no spurious invalidation" */
    it("derives the same fingerprint, so the cached ARN keeps serving", async () => {
      const cache = new SharedCache();
      const deployment = deploymentWithCeiling("120");
      const account = awsAccount(deployment);
      const engine = () =>
        NlpLambdaRuntimeService.create({
          cache,
          resolver: account.resolverFor(deployment),
          imageUri: IMAGE,
          configFingerprint: studioLambdaConfigFingerprint(deploymentWithCeiling("120")),
        });
      await engine().resolveArn(PROJECT);
      account.sent.length = 0;

      const arn = await engine().resolveArn(PROJECT);

      expect(arn).toBe(ARN);
      expect(account.sent).toEqual([]);
      expect(cache.deleted).toEqual([]);
    });
  });
});
