/**
 * Unit tests for evaluation types and Zod schemas
 */
import { describe, it, expect } from "vitest";
import {
  evaluationStatusSchema,
  targetTypeSchema,
  targetMetadataSchema,
  targetInfoSchema,
  evaluationResultSchema,
  batchEntrySchema,
} from "../types";

describe("Evaluation Types", () => {
  describe("evaluationStatusSchema", () => {
    it("accepts valid statuses", () => {
      expect(evaluationStatusSchema.parse("processed")).toBe("processed");
      expect(evaluationStatusSchema.parse("error")).toBe("error");
      expect(evaluationStatusSchema.parse("skipped")).toBe("skipped");
    });

    it("rejects invalid statuses", () => {
      expect(() => evaluationStatusSchema.parse("invalid")).toThrow();
      expect(() => evaluationStatusSchema.parse("")).toThrow();
      expect(() => evaluationStatusSchema.parse(123)).toThrow();
    });
  });

  describe("targetTypeSchema", () => {
    it("accepts valid target types", () => {
      expect(targetTypeSchema.parse("prompt")).toBe("prompt");
      expect(targetTypeSchema.parse("agent")).toBe("agent");
      expect(targetTypeSchema.parse("custom")).toBe("custom");
    });

    it("rejects invalid target types", () => {
      expect(() => targetTypeSchema.parse("invalid")).toThrow();
      expect(() => targetTypeSchema.parse("llm")).toThrow();
    });
  });

  describe("targetMetadataSchema", () => {
    it("accepts valid metadata objects", () => {
      const metadata = {
        model: "gpt-4",
        temperature: 0.7,
        streaming: true,
      };
      expect(targetMetadataSchema.parse(metadata)).toEqual(metadata);
    });

    it("accepts empty objects", () => {
      expect(targetMetadataSchema.parse({})).toEqual({});
    });

    it("rejects nested objects", () => {
      const invalid = {
        config: { nested: "value" },
      };
      expect(() => targetMetadataSchema.parse(invalid)).toThrow();
    });

    it("rejects arrays as values", () => {
      const invalid = {
        tags: ["a", "b"],
      };
      expect(() => targetMetadataSchema.parse(invalid)).toThrow();
    });
  });

  describe("targetInfoSchema", () => {
    it("parses valid target info", () => {
      const target = {
        id: "target-1",
        name: "GPT-4 Baseline",
        type: "custom" as const,
        metadata: { model: "gpt-4" },
      };
      expect(targetInfoSchema.parse(target)).toEqual(target);
    });

    it("defaults type to custom", () => {
      const target = {
        id: "target-1",
        name: "GPT-4 Baseline",
      };
      const parsed = targetInfoSchema.parse(target);
      expect(parsed.type).toBe("custom");
    });

    it("accepts null metadata", () => {
      const target = {
        id: "target-1",
        name: "GPT-4",
        type: "prompt" as const,
        metadata: null,
      };
      expect(targetInfoSchema.parse(target).metadata).toBeNull();
    });

    it("requires id and name", () => {
      expect(() => targetInfoSchema.parse({ id: "1" })).toThrow();
      expect(() => targetInfoSchema.parse({ name: "test" })).toThrow();
    });
  });

  describe("evaluationResultSchema", () => {
    it("parses minimal evaluation result", () => {
      const result = {
        name: "accuracy",
        evaluator: "accuracy",
        trace_id: "abc123",
        status: "processed" as const,
      };
      expect(evaluationResultSchema.parse(result)).toMatchObject(result);
    });

    it("parses full evaluation result", () => {
      const result = {
        name: "faithfulness",
        evaluator: "ragas/faithfulness",
        trace_id: "abc123def456",
        status: "processed" as const,
        data: { input: "question", output: "answer" },
        score: 0.95,
        passed: true,
        details: "High faithfulness score",
        index: 0,
        label: "high",
        cost: 0.001,
        duration: 1500,
        target_id: "gpt4-baseline",
      };
      expect(evaluationResultSchema.parse(result)).toEqual(result);
    });

    it("parses error result with traceback", () => {
      const result = {
        name: "test",
        evaluator: "test",
        trace_id: "xyz",
        status: "error" as const,
        error_type: "ValueError",
        traceback: ["Error at line 1", "Error at line 2"],
        details: "Something went wrong",
      };
      expect(evaluationResultSchema.parse(result)).toMatchObject(result);
    });

    it("accepts null optional fields", () => {
      const result = {
        name: "test",
        evaluator: "test",
        trace_id: "xyz",
        status: "skipped" as const,
        score: null,
        passed: null,
        details: null,
      };
      expect(evaluationResultSchema.parse(result)).toMatchObject({
        name: "test",
        status: "skipped",
      });
    });
  });

  describe("batchEntrySchema", () => {
    it("parses valid batch entry", () => {
      const entry = {
        index: 0,
        entry: { question: "What is 2+2?", answer: "4" },
        duration: 150,
        trace_id: "abc123",
      };
      expect(batchEntrySchema.parse(entry)).toEqual(entry);
    });

    it("accepts error field", () => {
      const entry = {
        index: 1,
        entry: { question: "test" },
        duration: 50,
        trace_id: "xyz",
        error: "Timeout occurred",
      };
      expect(batchEntrySchema.parse(entry).error).toBe("Timeout occurred");
    });

    it("requires all mandatory fields", () => {
      expect(() => batchEntrySchema.parse({ index: 0 })).toThrow();
      expect(() => batchEntrySchema.parse({ index: 0, entry: {} })).toThrow();
    });

    it("accepts complex entry objects", () => {
      const entry = {
        index: 0,
        entry: {
          nested: { deeply: { value: "test" } },
          array: [1, 2, 3],
          mixed: [{ a: 1 }, "string", 123],
        },
        duration: 100,
        trace_id: "test",
      };
      expect(batchEntrySchema.parse(entry).entry).toEqual(entry.entry);
    });
  });
});
