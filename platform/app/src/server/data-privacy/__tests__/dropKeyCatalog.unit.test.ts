import { describe, expect, it } from "vitest";

import { compileAttributePatterns } from "../attributePatternMatcher";
import {
  type Disposition,
  EMPTY_AUDIENCE,
  type ResolvedDataPrivacy,
} from "../dataPrivacy.types";
import {
  computeDropMatchers,
  computeDroppedKeys,
  droppedCategories,
  stripDroppedAttributes,
} from "../dropKeyCatalog";

function policy(
  dispositions: Partial<
    Record<"input" | "output" | "system" | "tools", Disposition>
  >,
  customAttributes: ResolvedDataPrivacy["customAttributes"] = [],
): ResolvedDataPrivacy {
  const cat = (d: Disposition = "capture") => ({
    disposition: d,
    audience: { ...EMPTY_AUDIENCE },
  });
  return {
    categories: {
      input: cat(dispositions.input),
      output: cat(dispositions.output),
      system: cat(dispositions.system),
      tools: cat(dispositions.tools),
    },
    pii: { level: "essential", entities: [] },
    secrets: { enabled: true, customPatterns: [] },
    customAttributes,
  };
}

function dropRule(
  pattern: string,
): ResolvedDataPrivacy["customAttributes"][number] {
  return { pattern, disposition: "drop", audience: { ...EMPTY_AUDIENCE } };
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

  describe("given nothing is dropped", () => {
    it("returns an empty set", () => {
      expect(computeDroppedKeys(policy({})).size).toBe(0);
    });
  });
});

describe("computeDropMatchers", () => {
  describe("given drop and restrict custom attribute rules", () => {
    it("compiles only the drop-disposition patterns", () => {
      const matchers = computeDropMatchers(
        policy({}, [
          dropRule("http.request.body"),
          {
            pattern: "app.billing.*",
            disposition: "restrict",
            audience: { ...EMPTY_AUDIENCE },
          },
        ]),
      );

      expect(matchers.map((m) => m.pattern)).toEqual(["http.request.body"]);
    });
  });
});

describe("droppedCategories", () => {
  it("lists only the categories set to drop", () => {
    expect(
      droppedCategories(policy({ input: "drop", output: "restrict" })),
    ).toEqual(["input"]);
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

  describe("given a wildcard drop matcher", () => {
    it("removes every matching key and reports their names", () => {
      const attributes = {
        "app.internal.session": "s-1",
        "app.internal.token": "t-1",
        "app.public.label": "ok",
      };
      const {
        attributes: next,
        droppedCount,
        droppedAttributeKeys,
      } = stripDroppedAttributes(
        attributes,
        new Set(),
        compileAttributePatterns(["app.internal.*"]),
      );

      expect(next["app.internal.session"]).toBeUndefined();
      expect(next["app.internal.token"]).toBeUndefined();
      expect(next["app.public.label"]).toBe("ok");
      expect(droppedCount).toBe(2);
      expect(droppedAttributeKeys.sort()).toEqual([
        "app.internal.session",
        "app.internal.token",
      ]);
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
