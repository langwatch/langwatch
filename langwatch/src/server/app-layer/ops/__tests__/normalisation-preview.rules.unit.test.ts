import { describe, expect, it } from "vitest";

import {
  applyMappingRules,
  compileMappingRules,
  InvalidMappingRuleError,
  type MappingRule,
} from "../normalisation-preview.rules";

const rule = (overrides: {
  key: string;
  keyIsRegex?: boolean;
  valuePattern?: string;
  type?: "copy" | "move";
  targetKey: string;
}): MappingRule => ({
  kind: "map",
  match: {
    key: overrides.key,
    keyIsRegex: overrides.keyIsRegex ?? false,
    valuePattern: overrides.valuePattern,
  },
  action: {
    type: overrides.type ?? "copy",
    targetKey: overrides.targetKey,
  },
});

describe("applyMappingRules", () => {
  describe("given an exact-key copy rule", () => {
    it("copies the value to the target key and keeps the source", () => {
      const compiled = compileMappingRules([
        rule({ key: "vendor.input", targetKey: "langwatch.input" }),
      ]);

      const result = applyMappingRules(
        { "vendor.input": "hello", untouched: 1 },
        compiled,
      );

      expect(result.attributes).toEqual({
        "vendor.input": "hello",
        "langwatch.input": "hello",
        untouched: 1,
      });
      expect(result.ruleResults[0]).toEqual({
        ruleIndex: 0,
        matchedKeys: ["vendor.input"],
        writes: [{ sourceKey: "vendor.input", targetKey: "langwatch.input" }],
        error: null,
      });
    });

    it("does not match when the key is absent", () => {
      const compiled = compileMappingRules([
        rule({ key: "vendor.input", targetKey: "langwatch.input" }),
      ]);

      const result = applyMappingRules({ other: "x" }, compiled);

      expect(result.attributes).toEqual({ other: "x" });
      expect(result.ruleResults[0]?.matchedKeys).toEqual([]);
    });
  });

  describe("given a move rule", () => {
    it("removes the source key after writing the target", () => {
      const compiled = compileMappingRules([
        rule({
          key: "vendor.output",
          targetKey: "langwatch.output",
          type: "move",
        }),
      ]);

      const result = applyMappingRules({ "vendor.output": "done" }, compiled);

      expect(result.attributes).toEqual({ "langwatch.output": "done" });
    });
  });

  describe("given a regex key rule", () => {
    it("matches every attribute key the regex hits", () => {
      const compiled = compileMappingRules([
        rule({
          key: "^gcp\\.vertex\\.agent\\.tool_",
          keyIsRegex: true,
          targetKey: "langwatch.input",
        }),
      ]);

      const result = applyMappingRules(
        {
          "gcp.vertex.agent.tool_call_args": '{"city":"Amsterdam"}',
          "gcp.vertex.agent.session_id": "s-1",
        },
        compiled,
      );

      expect(result.ruleResults[0]?.matchedKeys).toEqual([
        "gcp.vertex.agent.tool_call_args",
      ]);
      expect(result.attributes["langwatch.input"]).toBe(
        '{"city":"Amsterdam"}',
      );
    });
  });

  describe("given a value pattern with a capture group", () => {
    it("extracts capture group 1 as the produced value", () => {
      const compiled = compileMappingRules([
        rule({
          key: "vendor.blob",
          valuePattern: '"model":"([^"]+)"',
          targetKey: "gen_ai.request.model",
        }),
      ]);

      const result = applyMappingRules(
        { "vendor.blob": '{"model":"gemini-2.5-pro","other":1}' },
        compiled,
      );

      expect(result.attributes["gen_ai.request.model"]).toBe("gemini-2.5-pro");
    });

    it("stringifies object values before matching", () => {
      const compiled = compileMappingRules([
        rule({
          key: "vendor.blob",
          valuePattern: '"model":"([^"]+)"',
          targetKey: "gen_ai.request.model",
        }),
      ]);

      const result = applyMappingRules(
        { "vendor.blob": { model: "gemini-2.5-pro" } },
        compiled,
      );

      expect(result.attributes["gen_ai.request.model"]).toBe("gemini-2.5-pro");
    });

    it("does not match when the pattern misses", () => {
      const compiled = compileMappingRules([
        rule({
          key: "vendor.blob",
          valuePattern: '"nope":"([^"]+)"',
          targetKey: "gen_ai.request.model",
        }),
      ]);

      const result = applyMappingRules({ "vendor.blob": "{}" }, compiled);

      expect(result.attributes["gen_ai.request.model"]).toBeUndefined();
      expect(result.ruleResults[0]?.matchedKeys).toEqual([]);
    });
  });

  describe("given multiple rules", () => {
    it("later rules see earlier rules' writes", () => {
      const compiled = compileMappingRules([
        rule({ key: "a", targetKey: "b", type: "move" }),
        rule({ key: "b", targetKey: "c" }),
      ]);

      const result = applyMappingRules({ a: "v" }, compiled);

      expect(result.attributes).toEqual({ b: "v", c: "v" });
    });
  });

  describe("given the input attributes", () => {
    it("never mutates them", () => {
      const attrs = { "vendor.output": "done" };
      const compiled = compileMappingRules([
        rule({
          key: "vendor.output",
          targetKey: "langwatch.output",
          type: "move",
        }),
      ]);

      applyMappingRules(attrs, compiled);

      expect(attrs).toEqual({ "vendor.output": "done" });
    });
  });
});

describe("compileMappingRules", () => {
  describe("given an invalid key regex", () => {
    it("throws naming the rule and field", () => {
      expect(() =>
        compileMappingRules([
          rule({ key: "([", keyIsRegex: true, targetKey: "t" }),
        ]),
      ).toThrowError(InvalidMappingRuleError);
      expect(() =>
        compileMappingRules([
          rule({ key: "([", keyIsRegex: true, targetKey: "t" }),
        ]),
      ).toThrowError(/Rule 1: invalid match\.key/);
    });
  });

  describe("given an invalid value pattern", () => {
    it("throws naming the rule and field", () => {
      expect(() =>
        compileMappingRules([
          rule({ key: "k", valuePattern: "([", targetKey: "t" }),
        ]),
      ).toThrowError(/Rule 1: invalid match\.valuePattern/);
    });
  });

  describe("given an expression that does not parse", () => {
    it("throws naming the rule", () => {
      expect(() =>
        compileMappingRules([
          { kind: "expression", expression: "attrs |>", targetKey: "t" },
        ]),
      ).toThrowError(/Rule 1: invalid expression/);
    });
  });
});

describe("applyMappingRules with expression rules", () => {
  const expr = (expression: string, targetKey = "langwatch.input"): MappingRule => ({
    kind: "expression",
    expression,
    targetKey,
  });

  describe("given an expression reading attributes via attr()", () => {
    it("writes the evaluated result to the target key", () => {
      const compiled = compileMappingRules([
        expr('attr("vendor.user_name") |> upper'),
      ]);

      const result = applyMappingRules(
        { "vendor.user_name": "amsterdam" },
        compiled,
      );

      expect(result.attributes["langwatch.input"]).toBe("AMSTERDAM");
      expect(result.ruleResults[0]).toEqual({
        ruleIndex: 0,
        matchedKeys: [],
        writes: [{ sourceKey: null, targetKey: "langwatch.input" }],
        error: null,
      });
    });
  });

  describe("given pipes over structured attribute values", () => {
    it("supports filter/map over arrays", () => {
      const compiled = compileMappingRules([
        expr('attr("vendor.messages") |> filter(.role == "user") |> map(.text)'),
      ]);

      const result = applyMappingRules(
        {
          "vendor.messages": [
            { role: "user", text: "hi" },
            { role: "model", text: "hello" },
            { role: "user", text: "bye" },
          ],
        },
        compiled,
      );

      expect(result.attributes["langwatch.input"]).toEqual(["hi", "bye"]);
    });
  });

  describe("given the bag-style helpers", () => {
    it("has() probes for a key", () => {
      const compiled = compileMappingRules([
        expr('has("vendor.a") && !has("vendor.b")', "probe"),
      ]);

      const result = applyMappingRules({ "vendor.a": 1 }, compiled);

      expect(result.attributes.probe).toBe(true);
    });

    it("take() reads and consumes the source key", () => {
      const compiled = compileMappingRules([
        expr('take("vendor.output")', "langwatch.output"),
      ]);

      const result = applyMappingRules({ "vendor.output": "done" }, compiled);

      expect(result.attributes).toEqual({ "langwatch.output": "done" });
    });
  });

  describe("given an expression evaluating to null", () => {
    it("writes nothing", () => {
      const compiled = compileMappingRules([
        expr('attr("missing.key") ?? null'),
      ]);

      const result = applyMappingRules({ other: 1 }, compiled);

      expect(result.attributes).toEqual({ other: 1 });
      expect(result.ruleResults[0]?.writes).toEqual([]);
      expect(result.ruleResults[0]?.error).toBeNull();
    });
  });

  describe("given an expression that fails at runtime on this span", () => {
    it("records the error on the rule result instead of throwing", () => {
      const compiled = compileMappingRules([
        // filter over a non-array value → runtime type error
        expr('attr("vendor.messages") |> filter(.role == "user")'),
      ]);

      const result = applyMappingRules(
        { "vendor.messages": "not-an-array" },
        compiled,
      );

      expect(result.ruleResults[0]?.error).toBeTruthy();
      expect(result.attributes["langwatch.input"]).toBeUndefined();
    });
  });
});
