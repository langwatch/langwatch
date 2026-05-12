import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getProjectLambdaArn,
  createLambdaClient,
  clearLambdaArnCache,
  LAMBDA_ARN_CACHE_TTL_MS,
} from "../index";
import { LambdaClient } from "@aws-sdk/client-lambda";

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

describe("getProjectLambdaArn", () => {
  const mockProjectId = "test-project-123";
  const mockLambdaConfig = {
    FunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test-function",
    State: "Active",
    LastUpdateStatus: "Successful",
  };

  beforeEach(async () => {
    setConfig("123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest");
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
          Code: { ImageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest" },
        })
        .mockResolvedValueOnce({
          Configuration: mockLambdaConfig,
          Code: { ImageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest" },
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
          Code: { ImageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest" },
        });

      const calls = Array.from({ length: 100 }, () =>
        getProjectLambdaArn("projectA"),
      );
      // Let the event loop register all 100 awaiters before releasing.
      await new Promise((r) => setImmediate(r));
      resolveCheck({
        Configuration: mockLambdaConfig,
        Code: { ImageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest" },
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
        .mockRejectedValueOnce(Object.assign(new Error("Rate exceeded"), {
          name: "TooManyRequestsException",
        }))
        .mockRejectedValueOnce(new Error("hard create failure"))
        // Second resolution: clean success path.
        .mockResolvedValueOnce({
          Configuration: mockLambdaConfig,
          Code: { ImageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest" },
        })
        .mockResolvedValueOnce({
          Configuration: mockLambdaConfig,
          Code: { ImageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest" },
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
        Configuration: { FunctionArn: arn, State: "Active", LastUpdateStatus: "Successful" },
        Code: { ImageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest" },
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
});
