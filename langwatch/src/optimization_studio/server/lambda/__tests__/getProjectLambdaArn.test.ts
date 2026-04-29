import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getProjectLambdaArn, createLambdaClient } from "../index";
import { LambdaClient } from "@aws-sdk/client-lambda";

describe("getProjectLambdaArn", () => {
  const mockProjectId = "test-project-123";
  const mockLambdaConfig = {
    FunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test-function",
    State: "Active",
    LastUpdateStatus: "Successful",
  };

  beforeEach(() => {
    // Set up environment variable for config parsing
    process.env.LANGWATCH_NLP_LAMBDA_CONFIG = JSON.stringify({
      AWS_ACCESS_KEY_ID: "test-key",
      AWS_SECRET_ACCESS_KEY: "test-secret",
      AWS_REGION: "us-east-1",
      role_arn: "arn:aws:iam::123456789012:role/test-role",
      image_uri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/test:latest",
      cache_bucket: "test-bucket",
      subnet_ids: ["subnet-123"],
      security_group_ids: ["sg-123"],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LANGWATCH_NLP_LAMBDA_CONFIG;
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
});
