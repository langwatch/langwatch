import { describe, expect, it } from "vitest";
import { triggerFiltersSchema } from "../types";

describe("triggerFiltersSchema", () => {
  describe("when filter field is known", () => {
    it("accepts spans.model with string array", () => {
      const result = triggerFiltersSchema.safeParse({
        "spans.model": ["gpt-4"],
      });

      expect(result.success).toBe(true);
    });

    it("accepts nested filter values", () => {
      const result = triggerFiltersSchema.safeParse({
        "evaluations.score": { evaluator_1: ["0.5", "1.0"] },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("when filter field is unknown", () => {
    it("rejects service.name", () => {
      const result = triggerFiltersSchema.safeParse({
        "service.name": ["chat"],
      });

      expect(result.success).toBe(false);
    });

    it("rejects arbitrary field names", () => {
      const result = triggerFiltersSchema.safeParse({
        "some.random.field": ["value"],
      });

      expect(result.success).toBe(false);
    });
  });

  describe("when mixing known and unknown fields", () => {
    it("rejects the entire input", () => {
      const result = triggerFiltersSchema.safeParse({
        "spans.model": ["gpt-4"],
        "service.name": ["chat"],
      });

      expect(result.success).toBe(false);
    });
  });
});
