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
    process.env.LANGWATCH_NLP_LAMBDA_CONFIG = "{}";
  });

  afterEach(() => {
    delete process.env.LANGWATCH_NLP_LAMBDA_CONFIG;
  });

  describe("When race condition for creating Lambda", () => {
    it("should not throw exists error", async () => {
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
});
