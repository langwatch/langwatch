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
        producedKey: "langwatch.input",
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
      ).toThrowError(/Rule 1: invalid regex in match\.key/);
    });
  });

  describe("given an invalid value pattern", () => {
    it("throws naming the rule and field", () => {
      expect(() =>
        compileMappingRules([
          rule({ key: "k", valuePattern: "([", targetKey: "t" }),
        ]),
      ).toThrowError(/Rule 1: invalid regex in match\.valuePattern/);
    });
  });
});
