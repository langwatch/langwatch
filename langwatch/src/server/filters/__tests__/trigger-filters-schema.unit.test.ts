import { describe, expect, it } from "vitest";
import {
  sanitizeTriggerFilters,
  triggerFiltersPermissiveSchema,
  triggerFiltersSchema,
} from "../types";

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

describe("triggerFiltersPermissiveSchema", () => {
  describe("when filter values are structurally invalid", () => {
    it("rejects at the schema level", () => {
      const result = triggerFiltersPermissiveSchema.safeParse({
        "spans.model": "not-an-array",
      });

      expect(result.success).toBe(false);
    });
  });
});

describe("sanitizeTriggerFilters", () => {
  describe("when all fields are known", () => {
    it("passes them through unchanged", () => {
      const { sanitized } = sanitizeTriggerFilters({
        "spans.model": ["gpt-4"],
      });

      expect(sanitized).toEqual({ "spans.model": ["gpt-4"] });
    });
  });

  describe("when filter contains only unknown fields", () => {
    it("strips all keys and reports the unknown field names", () => {
      const { sanitized, unknownFields } = sanitizeTriggerFilters({
        "service.name": ["chat"],
      });

      expect(sanitized).toEqual({});
      expect(unknownFields).toEqual(["service.name"]);
    });
  });

  describe("when mixing known and unknown fields", () => {
    it("keeps known fields and reports unknown ones", () => {
      const { sanitized, unknownFields } = sanitizeTriggerFilters({
        "spans.model": ["gpt-4"],
        "service.name": ["chat"],
      });

      expect(sanitized).toEqual({ "spans.model": ["gpt-4"] });
      expect(unknownFields).toEqual(["service.name"]);
    });
  });
});
