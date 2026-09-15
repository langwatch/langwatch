import type {
  AgentConfig as AgentComponentConfig,
  AgentInputBinding,
} from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";

import { buildCodeConfig, DEFAULT_CODE, getCodeFromConfig } from "../agent-code-config.ts";
import type { Field } from "@langwatch/agent-contract";

describe("code-agent-config", () => {
  it("reads a code parameter and uses the default when it is absent", () => {
    const present = {
      parameters: [{ identifier: "code", type: "code", value: "print(1)" }],
    } satisfies AgentComponentConfig;
    const missing = { parameters: [] } satisfies AgentComponentConfig;

    expect(getCodeFromConfig(present)).toBe("print(1)");
    expect(getCodeFromConfig(missing)).toBe(DEFAULT_CODE);
  });

  it("uses the starter for malformed legacy code values", () => {
    const config = {
      parameters: [{ identifier: "code", type: "code", value: 42 }],
    } satisfies AgentComponentConfig;

    expect(getCodeFromConfig(config)).toBe(DEFAULT_CODE);
  });

  it("builds a code config without empty scenario wiring", () => {
    const inputs = [{ identifier: "input", type: "str" }] satisfies Field[];
    const outputs = [{ identifier: "output", type: "str" }] satisfies Field[];

    expect(buildCodeConfig({ code: "x", inputs, outputs })).toEqual({
      name: "Code",
      description: "Python code block",
      parameters: [{ identifier: "code", type: "code", value: "x" }],
      inputs,
      outputs,
    });
  });

  it("omits an explicitly empty scenario mapping", () => {
    const inputs = [{ identifier: "input", type: "str" }] satisfies Field[];
    const outputs = [{ identifier: "output", type: "str" }] satisfies Field[];
    const config = buildCodeConfig({ code: "x", inputs, outputs, scenarioMappings: {} });

    expect("scenarioMappings" in config).toBe(false);
  });

  it("preserves non-empty scenario wiring", () => {
    const inputs = [{ identifier: "input", type: "str" }] satisfies Field[];
    const outputs = [{ identifier: "output", type: "str" }] satisfies Field[];
    const scenarioMappings = {
      input: { type: "source", sourceId: "trace", path: ["input"] },
    } satisfies Record<string, AgentInputBinding>;

    expect(
      buildCodeConfig({
        code: "x",
        inputs,
        outputs,
        scenarioMappings,
        scenarioOutputField: "output",
      }),
    ).toMatchObject({ scenarioMappings, scenarioOutputField: "output" });
  });
});
