import { describe, expect, it } from "vitest";

import { areParametersUnused } from "../monitor-parameters.rules.ts";

const own = { kind: "own", settings: { model: "openai/gpt-5" } } as const;

describe("areParametersUnused", () => {
  describe("when the evaluator has settings of its own", () => {
    it("sets aside parameters that disagree with them", () => {
      expect(
        areParametersUnused({ ownSettings: own, parameters: { model: "openai/gpt-5-mini" } }),
      ).toBe(true);
    });

    it("keeps parameters that repeat them, in any key order", () => {
      expect(
        areParametersUnused({
          ownSettings: { kind: "own", settings: { model: "openai/gpt-5", temperature: 0 } },
          parameters: { temperature: 0, model: "openai/gpt-5" },
        }),
      ).toBe(false);
    });

    it("keeps no parameters, and an empty object", () => {
      expect(areParametersUnused({ ownSettings: own, parameters: undefined })).toBe(false);
      expect(areParametersUnused({ ownSettings: own, parameters: {} })).toBe(false);
    });
  });

  describe("when the run reads the monitor's parameters", () => {
    it("keeps whatever parameters are sent", () => {
      expect(
        areParametersUnused({ ownSettings: { kind: "none" }, parameters: { model: "any" } }),
      ).toBe(false);
    });
  });
});
