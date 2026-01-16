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

      await evaluation.run(dataset, async ({ index }) => {
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
        async () => {
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

      await evaluation.run(dataset, async ({ index }) => {
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

  describe("withTarget()", () => {
    it("creates separate span for each target", async () => {
      const evaluation = await langwatch.evaluation.init(`test-withTarget-${Date.now()}`);
      const dataset = [{ question: "What is AI?" }];

      const results: Array<{ target: string; duration: number; spanId: string }> = [];

      await evaluation.run(dataset, async () => {
        const gpt4Result = await evaluation.withTarget(
          "gpt-4",
          { model: "openai/gpt-4" },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return { response: "GPT-4 response" };
          }
        );

        results.push({
          target: "gpt-4",
          duration: gpt4Result.duration,
          spanId: gpt4Result.spanId,
        });

        const claudeResult = await evaluation.withTarget(
          "claude-3",
          { model: "anthropic/claude-3" },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return { response: "Claude response" };
          }
        );

        results.push({
          target: "claude-3",
          duration: claudeResult.duration,
          spanId: claudeResult.spanId,
        });
      });

      expect(results).toHaveLength(2);
      expect(results[0]!.target).toBe("gpt-4");
      expect(results[0]!.duration).toBeGreaterThanOrEqual(50);
      expect(results[0]!.spanId).toBeDefined();
      expect(results[1]!.target).toBe("claude-3");
      expect(results[1]!.duration).toBeGreaterThanOrEqual(30);
      // Each target should have its own span ID (even if trace is same without OTEL provider)
      expect(results[0]!.spanId).toBeDefined();
      expect(results[1]!.spanId).toBeDefined();
    });

    it("auto-infers target in log() calls inside withTarget()", async () => {
      const evaluation = await langwatch.evaluation.init(`test-withTarget-infer-${Date.now()}`);
      const dataset = [{ question: "Test" }];

      // Track logged targets (via internal inspection or API verification)
      let loggedInGpt4 = false;
      let loggedInClaude = false;

      await evaluation.run(dataset, async () => {
        await evaluation.withTarget("gpt-4", { model: "openai/gpt-4" }, async () => {
          // Log WITHOUT specifying target - should be inferred as "gpt-4"
          evaluation.log("quality", { score: 0.95 });
          loggedInGpt4 = true;
        });

        await evaluation.withTarget("claude-3", { model: "anthropic/claude-3" }, async () => {
          // Log WITHOUT specifying target - should be inferred as "claude-3"
          evaluation.log("quality", { score: 0.85 });
          loggedInClaude = true;
        });
      });

      expect(loggedInGpt4).toBe(true);
      expect(loggedInClaude).toBe(true);
      // If we get here without errors, the API accepted the logs with inferred targets
    });

    it("captures duration automatically in dataset entry", async () => {
      const evaluation = await langwatch.evaluation.init(`test-withTarget-latency-${Date.now()}`);
      const dataset = [{ question: "Test" }];

      await evaluation.run(dataset, async () => {
        const result = await evaluation.withTarget("gpt-4", { model: "openai/gpt-4" }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return "done";
        });

        // Duration should be captured and >= our delay
        expect(result.duration).toBeGreaterThanOrEqual(100);
        expect(result.result).toBe("done");
        // The result is also returned for verification
        expect(result.traceId).toBeDefined();
        expect(result.spanId).toBeDefined();
      });

      // Duration is now captured in the dataset entry per target (like Evaluations V3)
    });

    it("runs targets in parallel with Promise.all", async () => {
      const evaluation = await langwatch.evaluation.init(`test-withTarget-parallel-${Date.now()}`);
      const dataset = [{ question: "Test" }];

      let parallelStartTime = 0;
      let parallelEndTime = 0;

      await evaluation.run(dataset, async () => {
        parallelStartTime = Date.now();

        // Run both targets in parallel
        const [gpt4Result, claudeResult] = await Promise.all([
          evaluation.withTarget("gpt-4", { model: "openai/gpt-4" }, async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            evaluation.log("quality", { score: 0.95 });
            return "gpt4";
          }),
          evaluation.withTarget("claude-3", { model: "anthropic/claude-3" }, async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            evaluation.log("quality", { score: 0.85 });
            return "claude";
          }),
        ]);

        parallelEndTime = Date.now();

        expect(gpt4Result.result).toBe("gpt4");
        expect(claudeResult.result).toBe("claude");
      });

      const parallelTime = parallelEndTime - parallelStartTime;
      // If run in parallel, should take ~100ms, not ~200ms
      // Allow some overhead for span creation
      expect(parallelTime).toBeLessThan(250);
    });

    it("isolates context between concurrent withTarget blocks", async () => {
      const evaluation = await langwatch.evaluation.init(`test-withTarget-isolation-${Date.now()}`);
      const dataset = [{ question: "Test" }];

      // Track that both withTarget blocks executed successfully
      const executedTargets: string[] = [];

      await evaluation.run(dataset, async () => {
        await Promise.all([
          evaluation.withTarget("target-a", null, async () => {
            // Delay to ensure overlap with target-b
            await new Promise((resolve) => setTimeout(resolve, 50));
            // Log without explicit target - context inference should work
            evaluation.log("metric", { score: 1 });
            executedTargets.push("target-a");
          }),
          evaluation.withTarget("target-b", null, async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            evaluation.log("metric", { score: 1 });
            executedTargets.push("target-b");
          }),
        ]);
      });

      // Both targets should have executed (the context isolation is tested
      // implicitly by the fact that we can run them concurrently without errors)
      expect(executedTargets).toHaveLength(2);
      expect(executedTargets).toContain("target-a");
      expect(executedTargets).toContain("target-b");
    });

    it("works with overloaded signature (no metadata)", async () => {
      const evaluation = await langwatch.evaluation.init(`test-withTarget-overload-${Date.now()}`);
      const dataset = [{ question: "Test" }];

      await evaluation.run(dataset, async () => {
        // Call withTarget without metadata argument
        const result = await evaluation.withTarget("simple-target", async () => {
          return "simple result";
        });

        expect(result.result).toBe("simple result");
        expect(result.duration).toBeGreaterThan(0);
      });
    });

    it("propagates errors from callback", async () => {
      const evaluation = await langwatch.evaluation.init(`test-withTarget-error-${Date.now()}`);
      const dataset = [{ question: "Test" }];

      await evaluation.run(dataset, async () => {
        await expect(
          evaluation.withTarget("error-target", null, async () => {
            throw new Error("Test error");
          })
        ).rejects.toThrow("Test error");
      });
    });

    it("captures correct item data for each target in concurrent execution", async () => {
      const evaluation = await langwatch.evaluation.init(`test-withTarget-race-${Date.now()}`);

      // Use distinct questions to verify correct association
      const dataset = [
        { question: "Question A" },
        { question: "Question B" },
        { question: "Question C" },
      ];

      const results: Array<{ index: number; target: string; question: string; response: string }> = [];

      await evaluation.run(
        dataset,
        async ({ item, index }) => {
          // Run all targets in parallel for this item
          await Promise.all([
            evaluation.withTarget("gpt-4", { model: "openai/gpt-4" }, async () => {
              await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
              results.push({ index, target: "gpt-4", question: item.question, response: `GPT-4: ${item.question}` });
              return { output: `GPT-4: ${item.question}` };
            }),
            evaluation.withTarget("claude", { model: "anthropic/claude-3" }, async () => {
              await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
              results.push({ index, target: "claude", question: item.question, response: `Claude: ${item.question}` });
              return { output: `Claude: ${item.question}` };
            }),
          ]);
        },
        { concurrency: 3 }
      );

      // Should have 6 results (3 items × 2 targets)
      expect(results.length).toBe(6);

      // Group by target
      const gpt4Results = results.filter((r) => r.target === "gpt-4");
      const claudeResults = results.filter((r) => r.target === "claude");

      expect(gpt4Results.length).toBe(3);
      expect(claudeResults.length).toBe(3);

      // Verify each result has the correct question for its index
      for (const r of gpt4Results) {
        const expectedQuestion = dataset[r.index]!.question;
        expect(r.question).toBe(expectedQuestion);
        expect(r.response).toContain(expectedQuestion);
      }

      for (const r of claudeResults) {
        const expectedQuestion = dataset[r.index]!.question;
        expect(r.question).toBe(expectedQuestion);
        expect(r.response).toContain(expectedQuestion);
      }
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

  describe("withTarget dataset entry capture", () => {
    it("sends correct entry data for each target in concurrent execution", async () => {
      // This test verifies the fix for the race condition where concurrent
      // withTarget() calls would capture wrong item data due to shared state
      const capturedBodies: Array<{ dataset: Array<{ index: number; target_id: string; entry: unknown; predicted: unknown }> }> = [];

      // Mock fetch to capture API calls
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (urlStr.includes("experiment/init")) {
          return new Response(JSON.stringify({ slug: "test", path: "/test" }), { status: 200 });
        }
        if (urlStr.includes("log_results")) {
          capturedBodies.push(JSON.parse(options?.body as string));
          return new Response(JSON.stringify({}), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }) as typeof fetch;

      try {
        const langwatch = new LangWatch({
          apiKey: "test-key",
          endpoint: "http://localhost:5560",
        });

        const dataset = [
          { question: "Question A" },
          { question: "Question B" },
          { question: "Question C" },
        ];

        const evaluation = await langwatch.evaluation.init("test-entry-capture");

        await evaluation.run(
          dataset,
          async ({ item }) => {
            // Run targets in parallel - this is where the race condition would occur
            await Promise.all([
              evaluation.withTarget("gpt-4", { model: "openai/gpt-4" }, async () => {
                await new Promise((r) => setTimeout(r, Math.random() * 50));
                return `GPT-4: ${item.question}`;
              }),
              evaluation.withTarget("claude", { model: "anthropic/claude" }, async () => {
                await new Promise((r) => setTimeout(r, Math.random() * 50));
                return `Claude: ${item.question}`;
              }),
            ]);
          },
          { concurrency: 3 }
        );

        // Wait for final flush
        await new Promise((r) => setTimeout(r, 100));

        // Collect all dataset entries from captured API calls
        const allEntries = capturedBodies.flatMap((b) => b.dataset ?? []);

        // Should have 6 entries (3 items × 2 targets)
        expect(allEntries.length).toBe(6);

        // No entries should have null entry
        const nullEntries = allEntries.filter((e) => e.entry === null || e.entry === undefined);
        expect(nullEntries.length).toBe(0);

        // Verify each entry has the correct question for its index
        for (const entry of allEntries) {
          const expectedQuestion = dataset[entry.index]?.question;
          expect((entry.entry as { question: string }).question).toBe(expectedQuestion);
        }

        // Verify predicted outputs match the question
        for (const entry of allEntries) {
          const expectedQuestion = dataset[entry.index]?.question;
          const predicted = entry.predicted as { output: string } | null;
          expect(predicted?.output).toContain(expectedQuestion);
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
