/**
 * Integration tests for platform evaluations API (Evaluations V3)
 *
 * These tests require:
 * - LANGWATCH_ENDPOINT=http://localhost:5560 (or your backend URL)
 * - LANGWATCH_API_KEY set with a valid API key
 * - A saved evaluation with slug "test-evaluation" (or TEST_EVALUATION_SLUG env var)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { LangWatch } from "@/client-sdk";
import {
  EvaluationNotFoundError,
  EvaluationsApiError,
} from "../platformErrors";

// Skip if not configured for integration testing
const shouldRun =
  process.env.LANGWATCH_ENDPOINT && process.env.LANGWATCH_API_KEY;

describe.skipIf(!shouldRun)("Platform Evaluations Integration", () => {
  let langwatch: LangWatch;
  const testSlug =
    process.env.TEST_EVALUATION_SLUG ?? "test-evaluation";

  beforeAll(() => {
    langwatch = new LangWatch({
      apiKey: process.env.LANGWATCH_API_KEY,
      endpoint: process.env.LANGWATCH_ENDPOINT,
    });
  });

  describe("error handling", () => {
    it("throws EvaluationNotFoundError for non-existent slug", async () => {
      await expect(
        langwatch.experiments.run("non-existent-evaluation-slug-12345")
      ).rejects.toThrow(EvaluationNotFoundError);
    });

    it("throws EvaluationsApiError with invalid API key", async () => {
      const invalidClient = new LangWatch({
        apiKey: "invalid-api-key",
        endpoint: process.env.LANGWATCH_ENDPOINT,
      });

      await expect(
        invalidClient.experiments.run(testSlug)
      ).rejects.toThrow(EvaluationsApiError);
    });
  });

  describe("run evaluation", () => {
    it("runs an evaluation and returns results", async () => {
      // This test requires a real evaluation to be set up
      // Skip if TEST_EVALUATION_SLUG is not provided
      if (!process.env.TEST_EVALUATION_SLUG) {
        console.log("Skipping: TEST_EVALUATION_SLUG not set");
        return;
      }

      const result = await langwatch.experiments.run(testSlug, {
        timeout: 300000, // 5 minutes
        onProgress: (completed, total) => {
          console.log(`Progress: ${completed}/${total}`);
        },
      });

      expect(result.runId).toBeDefined();
      expect(result.status).toMatch(/completed|failed|stopped/);
      expect(typeof result.passed).toBe("number");
      expect(typeof result.failed).toBe("number");
      expect(typeof result.passRate).toBe("number");
      expect(typeof result.duration).toBe("number");
      expect(result.runUrl).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(typeof result.printSummary).toBe("function");
    }, 300000);

    it("reports progress during execution", async () => {
      if (!process.env.TEST_EVALUATION_SLUG) {
        console.log("Skipping: TEST_EVALUATION_SLUG not set");
        return;
      }

      const progressUpdates: Array<{ completed: number; total: number }> = [];

      await langwatch.experiments.run(testSlug, {
        timeout: 300000,
        onProgress: (completed, total) => {
          progressUpdates.push({ completed, total });
        },
      });

      // Should have received at least one progress update
      expect(progressUpdates.length).toBeGreaterThan(0);

      // Progress should increase (or stay same)
      for (let i = 1; i < progressUpdates.length; i++) {
        expect(progressUpdates[i]!.completed).toBeGreaterThanOrEqual(
          progressUpdates[i - 1]!.completed
        );
      }
    }, 300000);
  });
});
