import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import {
  LambdaClient,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../../env.mjs";
import { NLP_LAMBDA_MEMORY_SIZE_MB } from "../../../../server/nlpgo/timeouts";
import {
  clearLambdaArnCache,
  createLambdaClient,
  getProjectLambdaArn,
  LAMBDA_ARN_CACHE_TTL_MS,
} from "../index";

const setConfig = (imageUri: string) => {
  process.env.LANGWATCH_NLP_LAMBDA_CONFIG = JSON.stringify({
    AWS_ACCESS_KEY_ID: "test-key",
    AWS_SECRET_ACCESS_KEY: "test-secret",
    AWS_REGION: "us-east-1",
    role_arn: "arn:aws:iam::123456789012:role/test-role",
    image_uri: imageUri,
    cache_bucket: "test-bucket",
    subnet_ids: ["subnet-123"],
    security_group_ids: ["sg-123"],
  });
};

/** The env vars the module reconciles onto every per-project Lambda. Built from
 *  `env.BASE_HOST` rather than a literal because that value is supplied by the
 *  environment (unset locally, "localhost:3000" in CI), so a hardcoded string
 *  would make the fixture drift in one of the two. */
const desiredEnvVars = {
  LANGWATCH_ENDPOINT: env.BASE_HOST,
  STUDIO_RUNTIME: "async",
  AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
  CACHE_BUCKET: "test-bucket",
  NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS: "600",
};

describe("getProjectLambdaArn", () => {
  const mockProjectId = "test-project-123";
  // Already matches the desired configuration, so the reconcile path is a
  // no-op for every test that doesn't deliberately introduce drift — keeping
  // their exact AWS call counts intact.
  const mockLambdaConfig = {
    FunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test-function",
    State: "Active",
    LastUpdateStatus: "Successful",
    MemorySize: 2048,
    Environment: { Variables: { ...desiredEnvVars } },
  };

  beforeEach(async () => {
    setConfig("123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest");
    // Creating a project Lambda also provisions its log group. Stubbed so the
    // suite never reaches the network, which otherwise costs a real AWS
    // round trip per create-path test and fails noisily without credentials.
    vi.spyOn(CloudWatchLogsClient.prototype as any, "send").mockResolvedValue(
      {},
    );
    await clearLambdaArnCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.LANGWATCH_NLP_LAMBDA_CONFIG;
    await clearLambdaArnCache();
  });

  describe("When race condition for creating Lambda", () => {
    it("does not throw exists error", async () => {
      vi.spyOn(LambdaClient.prototype as any, "send")
        // Check first
        .mockResolvedValueOnce({ Configuration: null })
        // Create failed
        .mockRejectedValueOnce(new Error("already exist"))
        // Check second
        .mockResolvedValueOnce({ Configuration: mockLambdaConfig })
        // Handle polling
        .mockResolvedValueOnce({ Configuration: mockLambdaConfig });
      const result = await getProjectLambdaArn(mockProjectId);
      expect(result).toBe(mockLambdaConfig.FunctionArn);
    });
  });

  describe("given a Lambda client", () => {
    describe("when constructed via createLambdaClient", () => {
      it("configures maxAttempts above SDK default to ride out cold-start TooManyRequests bursts", async () => {
        const client = createLambdaClient();
        // SDK default is 3; we override to 6. Verifies the override is wired
        // through to the AWS SDK config so the cold-start regression that
        // hit prod on 2026-04-28 (account-level concurrency exhaustion →
        // "Rate Exceeded.") doesn't surface to Studio after 3 retries.
        expect(await client.config.maxAttempts()).toBe(6);
      });
    });
  });

  describe("When checkLambdaExists throws an error", () => {
    it("catches the error and attempts creation", async () => {
      vi.spyOn(LambdaClient.prototype as any, "send")
        // Check fails with unexpected error
        .mockRejectedValueOnce(new Error("Unexpected AWS error"))
        // Create succeeds
        .mockResolvedValueOnce(mockLambdaConfig)
        // Handle polling
        .mockResolvedValueOnce({ Configuration: mockLambdaConfig });

      const result = await getProjectLambdaArn(mockProjectId);
      expect(result).toBe(mockLambdaConfig.FunctionArn);
    });
  });

  describe("ARN cache + single-flight", () => {
    /** @scenario First call hits AWS; subsequent calls within TTL serve from cache with zero AWS calls */
    it("serves repeated calls within TTL from cache with zero AWS calls", async () => {
      const send = vi
        .spyOn(LambdaClient.prototype as any, "send")
        // First resolution: Configuration present, image_uri matches, poll Active.
        .mockResolvedValueOnce({
          Configuration: mockLambdaConfig,
          Code: {
            ImageUri:
              "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest",
          },
        })
        .mockResolvedValueOnce({
          Configuration: mockLambdaConfig,
          Code: {
            ImageUri:
              "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest",
          },
        })
        .mockResolvedValueOnce({ Configuration: mockLambdaConfig });

      const first = await getProjectLambdaArn("projectA");
      expect(first).toBe(mockLambdaConfig.FunctionArn);
      const callsAfterFirst = send.mock.calls.length;

      for (let i = 0; i < 50; i++) {
        const arn = await getProjectLambdaArn("projectA");
        expect(arn).toBe(mockLambdaConfig.FunctionArn);
      }
      expect(send.mock.calls.length).toBe(callsAfterFirst);
    });

    /** @scenario Concurrent burst for one project collapses into a single AWS resolution */
    it("collapses a concurrent burst into a single in-flight resolution", async () => {
      let resolveCheck: (v: any) => void = () => {};
      const send = vi
        .spyOn(LambdaClient.prototype as any, "send")
        // The very first GetFunction call hangs until we release it,
        // so all concurrent callers must queue on the in-flight promise.
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveCheck = resolve;
            }),
        )
        .mockResolvedValue({
          Configuration: mockLambdaConfig,
          Code: {
            ImageUri:
              "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest",
          },
        });

      const calls = Array.from({ length: 100 }, () =>
        getProjectLambdaArn("projectA"),
      );
      // Let the event loop register all 100 awaiters before releasing.
      await new Promise((r) => setImmediate(r));
      resolveCheck({
        Configuration: mockLambdaConfig,
        Code: {
          ImageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest",
        },
      });

      const arns = await Promise.all(calls);
      expect(new Set(arns)).toEqual(new Set([mockLambdaConfig.FunctionArn]));
      // Exactly one resolution flow: 1 GetFunction (existence) + 1 GetFunction
      // (image-URI check) + 1 GetFunction (poll). 3 total, NOT 300.
      expect(send.mock.calls.length).toBeLessThanOrEqual(3);
    });

    /** @scenario A failed resolution does not poison the cache */
    it("does not cache failures — TooManyRequests then success re-resolves", async () => {
      const send = vi
        .spyOn(LambdaClient.prototype as any, "send")
        // First resolution: GetFunction fails (treated as not-found by the
        // .catch handler in resolveProjectLambdaArn), then CreateFunction
        // fails with a non-recoverable error so the whole call rejects.
        .mockRejectedValueOnce(
          Object.assign(new Error("Rate exceeded"), {
            name: "TooManyRequestsException",
          }),
        )
        .mockRejectedValueOnce(new Error("hard create failure"))
        // Second resolution: clean success path.
        .mockResolvedValueOnce({
          Configuration: mockLambdaConfig,
          Code: {
            ImageUri:
              "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest",
          },
        })
        .mockResolvedValueOnce({
          Configuration: mockLambdaConfig,
          Code: {
            ImageUri:
              "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest",
          },
        })
        .mockResolvedValueOnce({ Configuration: mockLambdaConfig });

      await expect(getProjectLambdaArn("projectA")).rejects.toThrow();
      const callsAfterFailure = send.mock.calls.length;

      const arn = await getProjectLambdaArn("projectA");
      expect(arn).toBe(mockLambdaConfig.FunctionArn);
      expect(send.mock.calls.length).toBeGreaterThan(callsAfterFailure);
    });

    /** @scenario Deploy bumps image_uri and the cache invalidates automatically */
    it("invalidates the cache when image_uri changes (deploy)", async () => {
      vi.spyOn(LambdaClient.prototype as any, "send")
        // v1 resolution
        .mockResolvedValueOnce({
          Configuration: mockLambdaConfig,
          Code: { ImageUri: "ecr/foo:v1" },
        })
        .mockResolvedValueOnce({
          Configuration: mockLambdaConfig,
          Code: { ImageUri: "ecr/foo:v1" },
        })
        .mockResolvedValueOnce({ Configuration: mockLambdaConfig })
        // v2 resolution: re-runs the whole flow.
        .mockResolvedValueOnce({
          Configuration: mockLambdaConfig,
          Code: { ImageUri: "ecr/foo:v2" },
        })
        .mockResolvedValueOnce({
          Configuration: mockLambdaConfig,
          Code: { ImageUri: "ecr/foo:v2" },
        })
        .mockResolvedValueOnce({ Configuration: mockLambdaConfig });

      setConfig("ecr/foo:v1");
      await getProjectLambdaArn("projectA");

      setConfig("ecr/foo:v2");
      const send = LambdaClient.prototype.send as any;
      const callsBeforeV2 = send.mock.calls.length;
      await getProjectLambdaArn("projectA");
      expect(send.mock.calls.length).toBeGreaterThan(callsBeforeV2);
    });

    /** @scenario Different projects do not share cache slots */
    it("keeps cache entries independent per project", async () => {
      const arnA = "arn:aws:lambda:us-east-1:123:function:A";
      const arnB = "arn:aws:lambda:us-east-1:123:function:B";
      const cfg = (arn: string) => ({
        Configuration: {
          FunctionArn: arn,
          State: "Active",
          LastUpdateStatus: "Successful",
          // Matches the desired config so reconcile stays a no-op and the
          // mock chain below keeps its 1:1 mapping to AWS calls.
          MemorySize: 2048,
          Environment: { Variables: { ...desiredEnvVars } },
        },
        Code: {
          ImageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest",
        },
      });

      vi.spyOn(LambdaClient.prototype as any, "send")
        .mockResolvedValueOnce(cfg(arnA))
        .mockResolvedValueOnce(cfg(arnA))
        .mockResolvedValueOnce({ Configuration: cfg(arnA).Configuration })
        .mockResolvedValueOnce(cfg(arnB))
        .mockResolvedValueOnce(cfg(arnB))
        .mockResolvedValueOnce({ Configuration: cfg(arnB).Configuration });

      expect(await getProjectLambdaArn("projectA")).toBe(arnA);
      expect(await getProjectLambdaArn("projectB")).toBe(arnB);
      // Repeats are cache hits, never see each other.
      expect(await getProjectLambdaArn("projectA")).toBe(arnA);
      expect(await getProjectLambdaArn("projectB")).toBe(arnB);
    });

    it("exposes a TTL constant tuned for minute-scale burst absorption", () => {
      expect(LAMBDA_ARN_CACHE_TTL_MS).toBeGreaterThanOrEqual(60_000);
      expect(LAMBDA_ARN_CACHE_TTL_MS).toBeLessThanOrEqual(60 * 60_000);
    });
  });

  describe("config reconcile", () => {
    const currentImageUri =
      "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest";

    /** Indices of the UpdateFunctionConfiguration calls in send order. */
    const configUpdateCalls = (send: any) =>
      send.mock.calls.filter(
        (call: any[]) => call[0] instanceof UpdateFunctionConfigurationCommand,
      );

    /** @scenario A pre-existing Lambda carrying a stale env var is reconciled without clobbering unmanaged vars */
    it("updates drifted env vars and preserves unmanaged ones", async () => {
      const drifted = {
        ...mockLambdaConfig,
        Environment: {
          Variables: {
            ...desiredEnvVars,
            CACHE_BUCKET: "stale-bucket",
            SOME_OTHER_VAR: "keep-me",
          },
        },
      };

      const send = vi
        .spyOn(LambdaClient.prototype as any, "send")
        // checkLambdaExists
        .mockResolvedValueOnce({ Configuration: drifted })
        // GetFunction for image/config details
        .mockResolvedValueOnce({
          Configuration: drifted,
          Code: { ImageUri: currentImageUri },
        })
        // UpdateFunctionConfiguration
        .mockResolvedValueOnce(mockLambdaConfig)
        // Final poll
        .mockResolvedValue({ Configuration: mockLambdaConfig });

      const arn = await getProjectLambdaArn("reconcile-env");
      expect(arn).toBe(mockLambdaConfig.FunctionArn);

      const updates = configUpdateCalls(send);
      expect(updates).toHaveLength(1);
      expect(updates[0][0].input.FunctionName).toBe(
        "langwatch_nlp-reconcile-env",
      );
      expect(updates[0][0].input.Environment.Variables).toEqual({
        ...desiredEnvVars,
        SOME_OTHER_VAR: "keep-me",
      });
    });

    /** @scenario A Lambda still on the old 1024 MB default is raised to 2048 */
    it("raises a drifted MemorySize to the desired value", async () => {
      const drifted = { ...mockLambdaConfig, MemorySize: 1024 };

      const send = vi
        .spyOn(LambdaClient.prototype as any, "send")
        .mockResolvedValueOnce({ Configuration: drifted })
        .mockResolvedValueOnce({
          Configuration: drifted,
          Code: { ImageUri: currentImageUri },
        })
        .mockResolvedValueOnce(mockLambdaConfig)
        .mockResolvedValue({ Configuration: mockLambdaConfig });

      const arn = await getProjectLambdaArn("reconcile-memory");
      expect(arn).toBe(mockLambdaConfig.FunctionArn);

      const updates = configUpdateCalls(send);
      expect(updates).toHaveLength(1);
      expect(updates[0][0].input.MemorySize).toBe(
        NLP_LAMBDA_MEMORY_SIZE_MB,
      );
      expect(NLP_LAMBDA_MEMORY_SIZE_MB).toBe(2048);
    });

    /** @scenario No drift means no AWS write at all — the common path */
    it("issues no configuration update when nothing has drifted", async () => {
      const send = vi
        .spyOn(LambdaClient.prototype as any, "send")
        .mockResolvedValueOnce({ Configuration: mockLambdaConfig })
        .mockResolvedValueOnce({
          Configuration: mockLambdaConfig,
          Code: { ImageUri: currentImageUri },
        })
        .mockResolvedValue({ Configuration: mockLambdaConfig });

      const arn = await getProjectLambdaArn("reconcile-none");
      expect(arn).toBe(mockLambdaConfig.FunctionArn);
      expect(configUpdateCalls(send)).toHaveLength(0);
    });

    /** @scenario The code update lands and is polled to completion before the config update is sent */
    it("waits for the code update to land before updating configuration", async () => {
      const drifted = { ...mockLambdaConfig, MemorySize: 1024 };

      const send = vi
        .spyOn(LambdaClient.prototype as any, "send")
        .mockResolvedValueOnce({ Configuration: drifted })
        // Image URI differs from the configured one, forcing a code update.
        .mockResolvedValueOnce({
          Configuration: drifted,
          Code: { ImageUri: "ecr/foo:old" },
        })
        // UpdateFunctionCode
        .mockResolvedValueOnce(mockLambdaConfig)
        // Post-code-update poll
        .mockResolvedValueOnce({ Configuration: mockLambdaConfig })
        // UpdateFunctionConfiguration
        .mockResolvedValueOnce(mockLambdaConfig)
        // Final poll
        .mockResolvedValue({ Configuration: mockLambdaConfig });

      const arn = await getProjectLambdaArn("reconcile-ordering");
      expect(arn).toBe(mockLambdaConfig.FunctionArn);

      const commands = send.mock.calls.map((call: any[]) => call[0]);
      const codeIdx = commands.findIndex(
        (c: any) => c instanceof UpdateFunctionCodeCommand,
      );
      const configIdx = commands.findIndex(
        (c: any) => c instanceof UpdateFunctionConfigurationCommand,
      );
      expect(codeIdx).toBeGreaterThanOrEqual(0);
      expect(configIdx).toBeGreaterThan(codeIdx);
      // At least one GetFunction poll sits between them.
      const pollsBetween = commands
        .slice(codeIdx + 1, configIdx)
        .filter(
          (c: any) =>
            !(c instanceof UpdateFunctionCodeCommand) &&
            !(c instanceof UpdateFunctionConfigurationCommand),
        );
      expect(pollsBetween.length).toBeGreaterThanOrEqual(1);
    });

    /** @scenario A concurrent update makes AWS reject the reconcile but resolution still succeeds */
    it("swallows an in-progress conflict on the configuration update", async () => {
      const drifted = { ...mockLambdaConfig, MemorySize: 1024 };

      vi.spyOn(LambdaClient.prototype as any, "send")
        .mockResolvedValueOnce({ Configuration: drifted })
        .mockResolvedValueOnce({
          Configuration: drifted,
          Code: { ImageUri: currentImageUri },
        })
        .mockRejectedValueOnce(new Error("An update is in progress"))
        .mockResolvedValue({ Configuration: mockLambdaConfig });

      const arn = await getProjectLambdaArn("reconcile-conflict");
      expect(arn).toBe(mockLambdaConfig.FunctionArn);
    });
  });
});
