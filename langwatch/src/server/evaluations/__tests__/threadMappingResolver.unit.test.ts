import { describe, expect, it } from "vitest";
import { hasThreadMappings } from "../threadMappingResolver";
import type { MappingState } from "~/server/tracer/tracesMapping";

describe("hasThreadMappings", () => {
  describe("when mappingState is null", () => {
    it("returns false", () => {
      expect(hasThreadMappings(null)).toBe(false);
    });
  });

  describe("when mappingState is an empty object lacking the .mapping field", () => {
    it("returns false", () => {
      expect(hasThreadMappings({} as unknown as MappingState)).toBe(false);
    });
  });

  describe("when mappingState.mapping is empty", () => {
    it("returns false", () => {
      expect(
        hasThreadMappings({ mapping: {}, expansions: [] } as MappingState),
      ).toBe(false);
    });
  });

  describe("when mappingState.mapping contains only trace-typed entries", () => {
    it("returns false", () => {
      expect(
        hasThreadMappings({
          mapping: {
            input: { source: "input", key: undefined } as any,
          },
          expansions: [],
        } as MappingState),
      ).toBe(false);
    });
  });

  describe("when mappingState.mapping contains a thread-typed entry", () => {
    it("returns true", () => {
      expect(
        hasThreadMappings({
          mapping: {
            input: { source: "input", key: undefined } as any,
            history: { type: "thread", source: "input" } as any,
          },
          expansions: [],
        } as MappingState),
      ).toBe(true);
    });
  });
});
