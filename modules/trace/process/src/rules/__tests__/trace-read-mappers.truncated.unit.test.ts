import { describe, expect, it } from "vitest";

import { findTruncatedAttributesInParams } from "../trace-read-mappers.rules.ts";

describe("findTruncatedAttributesInParams", () => {
  describe("given span params whose marker was parsed into a list", () => {
    /** @scenario "The span detail says which values were cut" */
    it("returns the cut attributes", () => {
      const params = {
        langwatch: { truncated_attributes: [{ key: "gen_ai.input.messages", bytes: 9_000_000 }] },
      };

      expect(findTruncatedAttributesInParams(params)).toEqual([
        { key: "gen_ai.input.messages", bytes: 9_000_000 },
      ]);
    });
  });

  describe("given span params whose marker is still a JSON string", () => {
    it("returns the cut attributes", () => {
      const params = {
        langwatch: { truncated_attributes: JSON.stringify([{ key: "a", bytes: 1, on: "event" }]) },
      };

      expect(findTruncatedAttributesInParams(params)).toEqual([
        { key: "a", bytes: 1, on: "event" },
      ]);
    });
  });

  describe("given span params without a marker", () => {
    it("returns none", () => {
      expect(findTruncatedAttributesInParams({ langwatch: { span: { type: "llm" } } })).toEqual([]);
      expect(findTruncatedAttributesInParams(null)).toEqual([]);
    });
  });
});
