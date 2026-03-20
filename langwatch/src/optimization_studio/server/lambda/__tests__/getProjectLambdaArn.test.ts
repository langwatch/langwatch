import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getProjectLambdaArn } from "../index";
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
