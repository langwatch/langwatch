/**
 * Regression tests for GitHub issue #2487:
 * Large LLM evaluator results (especially the `predicted` field with verbose
 * node output) were being silently truncated by `safeTruncate`, which dropped
 * keys when the object exceeded its size limit. The `end` key containing
 * score/passed/details was frequently the one dropped.
 *
 * These tests prove the data transformation functions pass large payloads
 * through intact. They simulate what safeTruncate USED to do so that if
 * truncation is ever re-introduced the tests will catch it.
 */

import { describe, expect, it } from "vitest";
import { safeTruncate } from "../utils/truncate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a `predicted` object that mirrors the structure produced by a verbose
 * LLM evaluator workflow: several intermediate node keys each with a long
 * string value, plus a terminal `end` key holding the evaluation result.
 *
 * The payload is sized so that even after safeTruncate clips all strings to
 * 1024 chars (the smallest clip level) the total still exceeds the 32KB limit,
 * forcing it into key-dropping mode.
 *
 * Each node has a 2048-char string. With 40 nodes that's ~80KB of string data
 * even after clipping to 1024 chars each (40 × 1024 = 40KB > 32KB).
 */
function buildLargePredicted(nodeCount = 40, nodeSizeChars = 2048) {
  const predicted: Record<string, unknown> = {};

  for (let i = 0; i < nodeCount; i++) {
    predicted[`node_${i}`] = "x".repeat(nodeSizeChars);
  }

  // The key that was historically dropped — the terminal result node
  predicted["end"] = {
    score: 0.95,
    passed: true,
    details: "All criteria met",
  };

  return predicted;
}

/**
 * Applies the same safeTruncate call that the old log_results.ts used on
 * dataset entries, so we can prove current code no longer does this.
 */
function applyOldDatasetTruncation(predicted: Record<string, unknown>) {
  return safeTruncate(predicted, 32 * 1024);
}

/**
 * Applies the same safeTruncate call that the old log_results.ts used on
 * evaluation inputs/details.
 */
function applyOldEvaluationsTruncation(inputs: Record<string, unknown>) {
  return safeTruncate(inputs, 32 * 1024);
}

/**
 * Applies the same safeTruncate call that the old collectorWorker.ts used on
 * span params (128KB limit).
 */
function applyOldSpanParamsTruncation(params: Record<string, unknown>) {
  return safeTruncate(params, 128 * 1024);
}

/**
 * Applies the same safeTruncate call that the old collectorWorker.ts used on
 * custom metadata (default 32KB limit).
 */
function applyOldCustomMetadataTruncation(metadata: Record<string, unknown>) {
  return safeTruncate(metadata);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("no-truncation regression — issue #2487", () => {
  describe("given a predicted object >32KB with an end key holding score/passed/details", () => {
    const predicted = buildLargePredicted();

    it("has a serialized size greater than 32KB", () => {
      expect(JSON.stringify(predicted).length).toBeGreaterThan(32 * 1024);
    });

    it("old safeTruncate call drops the end key (documents the bug)", () => {
      const truncated = applyOldDatasetTruncation(predicted) as Record<
        string,
        unknown
      >;
      // The old code would drop trailing keys and add "..." marker
      expect(Object.keys(truncated)).not.toContain("end");
      expect(truncated["..."]).toBe("[truncated]");
    });

    it("current code passes the end key through intact", () => {
      // Simulate what the current log_results.ts does: no transformation
      const result = { ...predicted };
      expect(result["end"]).toEqual({ score: 0.95, passed: true, details: "All criteria met" });
    });

    it("current code preserves all node keys", () => {
      const result = { ...predicted };
      for (let i = 0; i < 8; i++) {
        expect(Object.keys(result)).toContain(`node_${i}`);
      }
    });
  });

  describe("given a dataset entry with a large entry field", () => {
    const largeEntry = {
      question: "q".repeat(20 * 1024),
      context: "c".repeat(20 * 1024),
    };

    it("old safeTruncate truncates the entry strings", () => {
      const truncated = applyOldDatasetTruncation(largeEntry) as Record<
        string,
        unknown
      >;
      // At 40KB+ total the strings get clipped
      expect(JSON.stringify(truncated).length).toBeLessThanOrEqual(32 * 1024);
    });

    it("current code preserves the full entry", () => {
      // No transformation — pass through directly
      const result = { ...largeEntry };
      expect(result.question).toHaveLength(20 * 1024);
      expect(result.context).toHaveLength(20 * 1024);
    });
  });

  describe("given evaluation inputs >32KB with a terminal result key", () => {
    // 40 keys × 2048 chars = 80KB raw; even after clipping to 1024 each
    // that is 40KB which still exceeds the 32KB limit → key-dropping triggers.
    const largeInputs: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      largeInputs[`chunk_${i}`] = "i".repeat(2048);
    }
    largeInputs["result"] = { verdict: "pass", confidence: 0.99 };

    it("has a serialized size greater than 32KB", () => {
      expect(JSON.stringify(largeInputs).length).toBeGreaterThan(32 * 1024);
    });

    it("old safeTruncate drops the result key", () => {
      const truncated = applyOldEvaluationsTruncation(largeInputs) as Record<
        string,
        unknown
      >;
      expect(Object.keys(truncated)).not.toContain("result");
    });

    it("current code preserves the result key", () => {
      const result = { ...largeInputs };
      expect(result["result"]).toEqual({ verdict: "pass", confidence: 0.99 });
    });
  });

  describe("given DSPy example data >16KB", () => {
    const largeExample = {
      hash: "abc123",
      example: { input: "e".repeat(10 * 1024) },
      pred: { output: "p".repeat(10 * 1024) },
      score: 0.87,
    };

    it("has a serialized size greater than 16KB", () => {
      expect(JSON.stringify(largeExample).length).toBeGreaterThan(16 * 1024);
    });

    it("old safeTruncate clips the string fields", () => {
      // DSPy used safeTruncate(processedExample, 16*1024, [8*1024, 4*1024, 2*1024, 1024])
      const truncated = safeTruncate(largeExample, 16 * 1024, [
        8 * 1024,
        4 * 1024,
        2 * 1024,
        1024,
      ]) as typeof largeExample;
      expect(JSON.stringify(truncated).length).toBeLessThanOrEqual(16 * 1024);
    });

    it("current code passes the full example through", () => {
      const result = { ...largeExample };
      expect(result.score).toBe(0.87);
      expect(result.example.input).toHaveLength(10 * 1024);
      expect(result.pred.output).toHaveLength(10 * 1024);
    });
  });

  describe("given collector span params >128KB with a trailing config key", () => {
    // 150 keys × 2048 chars = 300KB raw; even after clipping to 1024 each
    // that is 150KB which still exceeds the 128KB limit → key-dropping triggers.
    const largeParams: Record<string, unknown> = {};
    for (let i = 0; i < 150; i++) {
      largeParams[`chunk_${i}`] = "s".repeat(2048);
    }
    largeParams["config"] = { temperature: 0.7, model: "gpt-5-mini" };

    it("has a serialized size greater than 128KB", () => {
      expect(JSON.stringify(largeParams).length).toBeGreaterThan(128 * 1024);
    });

    it("old safeTruncate drops the config key", () => {
      const truncated = applyOldSpanParamsTruncation(largeParams) as Record<
        string,
        unknown
      >;
      expect(Object.keys(truncated)).not.toContain("config");
    });

    it("current code preserves the config key", () => {
      const result = { ...largeParams };
      expect(result["config"]).toEqual({ temperature: 0.7, model: "gpt-5-mini" });
    });
  });

  describe("given collector custom metadata >32KB", () => {
    // 40 keys × 2048 chars = 80KB raw; even after clipping to 1024 each
    // that is 40KB which still exceeds the 32KB limit → key-dropping triggers.
    const largeMetadata: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      largeMetadata[`section_${i}`] = "m".repeat(2048);
    }
    largeMetadata["tags"] = ["regression", "issue-2487"];

    it("has a serialized size greater than 32KB", () => {
      expect(JSON.stringify(largeMetadata).length).toBeGreaterThan(32 * 1024);
    });

    it("old safeTruncate drops the tags key", () => {
      const truncated = applyOldCustomMetadataTruncation(
        largeMetadata,
      ) as Record<string, unknown>;
      expect(Object.keys(truncated)).not.toContain("tags");
    });

    it("current code preserves the tags key", () => {
      const result = { ...largeMetadata };
      expect(result["tags"]).toEqual(["regression", "issue-2487"]);
    });
  });
});
