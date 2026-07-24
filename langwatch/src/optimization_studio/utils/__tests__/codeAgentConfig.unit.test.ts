import { describe, expect, it } from "vitest";

import type { AgentComponentConfig } from "~/server/agents/agent.repository";

import {
  DEFAULT_CODE,
  buildCodeConfig,
  getCodeFromConfig,
} from "../codeAgentConfig";

describe("codeAgentConfig", () => {
  describe("getCodeFromConfig", () => {
    describe("given a config carrying a code parameter", () => {
      it("returns the code parameter value", () => {
        const config = {
          parameters: [{ identifier: "code", type: "code", value: "print(1)" }],
        } as unknown as AgentComponentConfig;
        expect(getCodeFromConfig(config)).toBe("print(1)");
      });
    });

    describe("given a config without a code parameter", () => {
      it("falls back to the default code", () => {
        const config = { parameters: [] } as unknown as AgentComponentConfig;
        expect(getCodeFromConfig(config)).toBe(DEFAULT_CODE);
      });
    });
  });

  describe("buildCodeConfig", () => {
    const inputs = [{ identifier: "input", type: "str" as const }];
    const outputs = [{ identifier: "output", type: "str" as const }];

    describe("when no scenario wiring is supplied (properties panel path)", () => {
      it("omits the scenario keys entirely", () => {
        const config = buildCodeConfig({ code: "x", inputs, outputs });
        expect(config.name).toBe("Code");
        expect(config.parameters[0]).toMatchObject({
          identifier: "code",
          value: "x",
        });
        expect("scenarioMappings" in config).toBe(false);
        expect("scenarioOutputField" in config).toBe(false);
      });
    });

    describe("when an empty scenarioMappings map is supplied", () => {
      it("still omits scenarioMappings", () => {
        const config = buildCodeConfig({
          code: "x",
          inputs,
          outputs,
          scenarioMappings: {},
        });
        expect("scenarioMappings" in config).toBe(false);
      });
    });

    describe("when scenario wiring is supplied (editor drawer path)", () => {
      it("includes the scenario keys", () => {
        const config = buildCodeConfig({
          code: "x",
          inputs,
          outputs,
          scenarioMappings: {
            input: { source: "trace", key: "input" } as never,
          },
          scenarioOutputField: "output",
        });
        expect(config.scenarioMappings).toEqual({
          input: { source: "trace", key: "input" },
        });
        expect(config.scenarioOutputField).toBe("output");
      });
    });
  });
});
