import { describe, expect, it } from "vitest";

import {
  computeDroppedKeys,
  droppedCategories,
  stripDroppedAttributes,
} from "../dropKeyCatalog";
import {
  EMPTY_AUDIENCE,
  type Disposition,
  type ResolvedDataPrivacy,
} from "../dataPrivacy.types";

function policy(
  dispositions: Partial<Record<"input" | "output" | "system" | "tools", Disposition>>,
  customDropKeys: string[] = [],
): ResolvedDataPrivacy {
  const cat = (d: Disposition = "capture") => ({ disposition: d, audience: { ...EMPTY_AUDIENCE } });
  return {
    categories: {
      input: cat(dispositions.input),
      output: cat(dispositions.output),
      system: cat(dispositions.system),
      tools: cat(dispositions.tools),
    },
    pii: { level: "essential" },
    secrets: { enabled: true, customPatterns: [] },
    customDropKeys,
  };
}

describe("computeDroppedKeys", () => {
  describe("given input and tools are set to drop", () => {
    it("includes the input and tool keys but not output or system keys", () => {
      const keys = computeDroppedKeys(policy({ input: "drop", tools: "drop" }));

      expect(keys.has("gen_ai.input.messages")).toBe(true);
      expect(keys.has("ai.toolCall")).toBe(true);
      expect(keys.has("gen_ai.output.messages")).toBe(false);
      expect(keys.has("gen_ai.system_instructions")).toBe(false);
    });
  });

  describe("given custom drop keys", () => {
    it("adds them to the set", () => {
      const keys = computeDroppedKeys(policy({}, ["http.request.body"]));
      expect(keys.has("http.request.body")).toBe(true);
    });
  });

  describe("given nothing is dropped", () => {
    it("returns an empty set", () => {
      expect(computeDroppedKeys(policy({})).size).toBe(0);
    });
  });
});

describe("droppedCategories", () => {
  it("lists only the categories set to drop", () => {
    expect(droppedCategories(policy({ input: "drop", output: "restrict" }))).toEqual(["input"]);
  });
});

describe("stripDroppedAttributes", () => {
  describe("given dropped keys present alongside metadata", () => {
    it("removes the dropped keys and keeps the metadata", () => {
      const attributes = {
        "gen_ai.input.messages": "hello",
        "gen_ai.usage.input_tokens": 12,
        "gen_ai.request.model": "gpt-5",
      };
      const { attributes: next, droppedCount } = stripDroppedAttributes(
        attributes,
        new Set(["gen_ai.input.messages"]),
      );

      expect(next["gen_ai.input.messages"]).toBeUndefined();
      expect(next["gen_ai.usage.input_tokens"]).toBe(12);
      expect(next["gen_ai.request.model"]).toBe("gpt-5");
      expect(droppedCount).toBe(1);
    });
  });

  describe("given no dropped keys", () => {
    it("returns the same object untouched", () => {
      const attributes = { a: 1 };
      const result = stripDroppedAttributes(attributes, new Set());
      expect(result.attributes).toBe(attributes);
      expect(result.droppedCount).toBe(0);
    });
  });
});
