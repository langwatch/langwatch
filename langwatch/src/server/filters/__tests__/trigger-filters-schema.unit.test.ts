import { describe, expect, it } from "vitest";
import {
  sanitizeTriggerFilters,
  triggerFiltersRawSchema,
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

describe("triggerFiltersSchemaLenient", () => {
  describe("when all fields are known", () => {
    it("passes them through unchanged", () => {
      const result = triggerFiltersRawSchema.safeParse({
        "spans.model": ["gpt-4"],
      });

      expect(result.success).toBe(true);
      expect(sanitizeTriggerFilters(result.data ?? {}).sanitizedFilters).toEqual({
        "spans.model": ["gpt-4"],
      });
    });
  });

  describe("when filter contains only unknown fields", () => {
    it("strips all keys and returns an empty object", () => {
      const result = triggerFiltersRawSchema.safeParse({
        "service.name": ["chat"],
      });

      expect(result.success).toBe(true);
      expect(sanitizeTriggerFilters(result.data ?? {}).sanitizedFilters).toEqual(
        {},
      );
      expect(sanitizeTriggerFilters(result.data ?? {}).unknownFields).toEqual([
        "service.name",
      ]);
    });
  });

  describe("when mixing known and unknown fields", () => {
    it("strips the unknown fields and keeps the known ones", () => {
      const result = triggerFiltersRawSchema.safeParse({
        "spans.model": ["gpt-4"],
        "service.name": ["chat"],
      });

      expect(result.success).toBe(true);
      expect(sanitizeTriggerFilters(result.data ?? {}).sanitizedFilters).toEqual(
        { "spans.model": ["gpt-4"] },
      );
      expect(sanitizeTriggerFilters(result.data ?? {}).unknownFields).toEqual([
        "service.name",
      ]);
    });
  });

  describe("when filter values are invalid", () => {
    it("rejects structurally invalid values", () => {
      const result = triggerFiltersRawSchema.safeParse({
        "spans.model": "not-an-array",
      });

      expect(result.success).toBe(false);
    });
  });
});
