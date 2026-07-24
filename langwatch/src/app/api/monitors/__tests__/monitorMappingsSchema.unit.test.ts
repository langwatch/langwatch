import { describe, expect, it } from "vitest";
import { monitorMappingsSchema } from "~/server/tracer/tracesMapping";

describe("monitorMappingsSchema (write-path coercion)", () => {
  describe("when mappings is omitted (undefined)", () => {
    it("passes through undefined", () => {
      const result = monitorMappingsSchema.parse(undefined);
      expect(result).toBeUndefined();
    });
  });

  describe("when mappings is null", () => {
    it("passes through null", () => {
      const result = monitorMappingsSchema.parse(null);
      expect(result).toBeNull();
    });
  });

  describe("when mappings is an empty object (legacy UI shape that caused issue #3875)", () => {
    it("coerces to a valid MappingState", () => {
      const result = monitorMappingsSchema.parse({});
      expect(result).toEqual({ mapping: {}, expansions: [] });
    });
  });

  describe("when mappings is a partial object missing .mapping", () => {
    it("coerces to a valid MappingState rather than persisting the malformed shape", () => {
      const result = monitorMappingsSchema.parse({ expansions: [] });
      expect(result).toEqual({ mapping: {}, expansions: [] });
    });
  });

  describe("when mappings is a properly shaped MappingState", () => {
    it("preserves the value", () => {
      const valid = {
        mapping: {
          input: { source: "input" as const, key: undefined, subkey: undefined },
        },
        expansions: [],
      };
      const result = monitorMappingsSchema.parse(valid);
      expect(result).toEqual(valid);
    });
  });
});
