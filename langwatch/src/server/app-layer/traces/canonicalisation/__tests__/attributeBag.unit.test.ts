import { describe, expect, it } from "vitest";

import type { NormalizedAttributes } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { AttributeBag } from "../attributeBag";

describe("AttributeBag", () => {
  describe("when takeByPrefix is called", () => {
    it("returns all entries matching the prefix and removes them", () => {
      const bag = new AttributeBag({
        "mastra.metadata.threadId": "thread-1",
        "mastra.metadata.runId": "run-42",
        "mastra.metadata.resourceId": "res-7",
        "gen_ai.usage.input_tokens": 100,
        "other.key": "value",
      } as NormalizedAttributes);

      const result = bag.takeByPrefix("mastra.metadata.");

      expect(result).toEqual([
        { key: "mastra.metadata.threadId", value: "thread-1" },
        { key: "mastra.metadata.runId", value: "run-42" },
        { key: "mastra.metadata.resourceId", value: "res-7" },
      ]);

      // Consumed keys are gone
      expect(bag.has("mastra.metadata.threadId")).toBe(false);
      expect(bag.has("mastra.metadata.runId")).toBe(false);
      expect(bag.has("mastra.metadata.resourceId")).toBe(false);

      // Non-matching keys remain
      expect(bag.has("gen_ai.usage.input_tokens")).toBe(true);
      expect(bag.has("other.key")).toBe(true);
    });

    it("returns empty array when no keys match the prefix", () => {
      const bag = new AttributeBag({
        "gen_ai.usage.input_tokens": 100,
      } as NormalizedAttributes);

      const result = bag.takeByPrefix("mastra.metadata.");

      expect(result).toEqual([]);
    });

    it("returns empty array for empty bag", () => {
      const bag = new AttributeBag({} as NormalizedAttributes);

      const result = bag.takeByPrefix("any.prefix.");

      expect(result).toEqual([]);
    });
  });
});
