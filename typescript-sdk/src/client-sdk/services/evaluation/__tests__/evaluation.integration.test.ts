/**
 * Integration tests for Evaluation API
 *
 * These tests run against a real LangWatch backend at localhost:5560
 * Set LANGWATCH_API_KEY and LANGWATCH_ENDPOINT environment variables
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { LangWatch } from "@/client-sdk";
import { Evaluation } from "../evaluation";
import { EvaluationInitError, TargetMetadataConflictError } from "../errors";

// Skip if no API key (CI environments without backend)
const SKIP_INTEGRATION = !process.env.LANGWATCH_API_KEY;

describe.skipIf(SKIP_INTEGRATION)("Evaluation Integration", () => {
  let langwatch: LangWatch;

  beforeAll(() => {
    langwatch = new LangWatch({
      apiKey: process.env.LANGWATCH_API_KEY,
      endpoint: process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560",
    });
  });

  describe("init()", () => {
    it("creates experiment and returns evaluation instance", async () => {
      const experimentName = `test-init-${Date.now()}`;
      const evaluation = await langwatch.evaluation.init(experimentName);

      expect(evaluation).toBeInstanceOf(Evaluation);
      expect(evaluation.name).toBe(experimentName);
      expect(evaluation.runId).toBeDefined();
      expect(evaluation.runId).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/); // Human readable ID
    });

    it("accepts custom runId", async () => {
      const customRunId = "my-custom-run-123";
      const evaluation = await langwatch.evaluation.init(`test-custom-run-${Date.now()}`, {
        runId: customRunId,
      });

      expect(evaluation.runId).toBe(customRunId);
    });

    it("throws EvaluationInitError with invalid API key", async () => {
      const badLangwatch = new LangWatch({
        apiKey: "invalid-key",
        endpoint: process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560",
      });

      await expect(
        badLangwatch.evaluation.init("test-bad-key")
      ).rejects.toThrow(EvaluationInitError);
    });
  });

  describe("run()", () => {
    it("executes callback for each dataset item", async () => {
      const evaluation = await langwatch.evaluation.init(`test-run-${Date.now()}`);
      const dataset = [
        { question: "What is 2+2?", expected: "4" },
        { question: "What is 3+3?", expected: "6" },
      ];

      const processed: number[] = [];

      await evaluation.run(dataset, async ({ item, index }) => {
        processed.push(index);
        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(processed).toEqual([0, 1]);
    });

    it("respects concurrency limit", async () => {
      const evaluation = await langwatch.evaluation.init(`test-concurrency-${Date.now()}`);
      const dataset = Array.from({ length: 10 }, (_, i) => ({ id: i }));

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      await evaluation.run(
        dataset,
        async ({ index }) => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

          // Simulate async work
          await new Promise((resolve) => setTimeout(resolve, 50));

          currentConcurrent--;
        },
        { concurrency: 3 }
      );

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it("handles errors in callback gracefully", async () => {
      const evaluation = await langwatch.evaluation.init(`test-errors-${Date.now()}`);
      const dataset = [{ id: 1 }, { id: 2 }, { id: 3 }];

      const processed: number[] = [];

      await evaluation.run(dataset, async ({ item, index }) => {
        processed.push(index);
        if (index === 1) {
          throw new Error("Simulated error");
        }
      });

      // All items should be processed despite error
      expect(processed.length).toBe(3);
    });
  });

  describe("log()", () => {
    it("logs metrics to the API", async () => {
      const evaluation = await langwatch.evaluation.init(`test-log-${Date.now()}`);
      const dataset = [{ question: "test" }];

      await evaluation.run(dataset, async ({ index }) => {
        evaluation.log("accuracy", { index, score: 0.95 });
        evaluation.log("latency", { index, score: 150 });
      });

      // If we get here without errors, the API accepted the logs
      expect(true).toBe(true);
    });

    it("logs with target and metadata", async () => {
      const evaluation = await langwatch.evaluation.init(`test-targets-${Date.now()}`);
      const dataset = [{ question: "test" }];

      await evaluation.run(dataset, async ({ index }) => {
        evaluation.log("accuracy", {
          index,
          score: 0.9,
          target: "gpt4",
          metadata: { model: "gpt-4", temperature: 0.7 },
        });

        evaluation.log("accuracy", {
          index,
          score: 0.85,
          target: "claude",
          metadata: { model: "claude-3", temperature: 0.5 },
        });
      });

      // Success if no errors
      expect(true).toBe(true);
    });
  });

  describe("target registration", () => {
    it("throws on conflicting metadata for same target", async () => {
      const evaluation = await langwatch.evaluation.init(`test-conflict-${Date.now()}`);

      // Register target first
      evaluation.log("m1", {
        index: 0,
        score: 1,
        target: "same-target",
        metadata: { model: "gpt-4" },
      });

      // Same target, different metadata should throw
      expect(() => {
        evaluation.log("m2", {
          index: 0,
          score: 1,
          target: "same-target",
          metadata: { model: "gpt-3.5" }, // Different!
        });
      }).toThrow(TargetMetadataConflictError);
    });

    it("allows same target without metadata after registration", async () => {
      const evaluation = await langwatch.evaluation.init(`test-no-conflict-${Date.now()}`);
      const dataset = [{ q: "test" }];

      await evaluation.run(dataset, async ({ index }) => {
        // First call with metadata
        evaluation.log("m1", {
          index,
          score: 1,
          target: "my-target",
          metadata: { model: "gpt-4" },
        });

        // Second call without metadata - should work
        evaluation.log("m2", {
          index,
          score: 0.9,
          target: "my-target",
        });
      });

      expect(true).toBe(true);
    });
  });
});

// Unit tests that don't require backend
describe("Evaluation Unit", () => {
  describe("humanReadableId", () => {
    it("generates adjective-adjective-noun pattern", async () => {
      const { generateHumanReadableId } = await import("../humanReadableId.js");

      const id = generateHumanReadableId();
      const parts = id.split("-");

      expect(parts.length).toBe(3);
      expect(parts[0]).toMatch(/^[a-z]+$/);
      expect(parts[1]).toMatch(/^[a-z]+$/);
      expect(parts[2]).toMatch(/^[a-z]+$/);
    });

    it("uses custom separator", async () => {
      const { generateHumanReadableId } = await import("../humanReadableId.js");

      const id = generateHumanReadableId("_");
      expect(id).toMatch(/^[a-z]+_[a-z]+_[a-z]+$/);
    });
  });
});
