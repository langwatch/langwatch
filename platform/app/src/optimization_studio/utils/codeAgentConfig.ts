import type { FieldMapping } from "~/components/variables";
import type { AgentComponentConfig } from "~/server/agents/agent.repository";

import type { CodeComponentConfig, Field } from "../types/dsl";

/** Default Python source shown when a new code agent is created. */
export const DEFAULT_CODE = `class Code:
    def __call__(self, input: str):
        # Your code goes here

        return {"output": input.upper()}
`;

/** Read the `code` parameter value out of a code agent config, or the default. */
export function getCodeFromConfig(config: AgentComponentConfig): string {
  const codeConfig = config as CodeComponentConfig;
  const codeParam = codeConfig.parameters?.find(
    (p) => p.identifier === "code" && p.type === "code",
  );
  return (codeParam?.value as string) ?? DEFAULT_CODE;
}

/**
 * Build a DSL-compatible Code component config.
 *
 * `scenarioMappings` / `scenarioOutputField` are optional: the optimization
 * studio properties panel omits them, while the agent editor drawer supplies
 * them. Each is included only when present, so a config built without scenario
 * wiring carries neither key.
 */
export function buildCodeConfig({
  code,
  inputs,
  outputs,
  scenarioMappings,
  scenarioOutputField,
}: {
  code: string;
  inputs: Field[];
  outputs: Field[];
  scenarioMappings?: Record<string, FieldMapping>;
  scenarioOutputField?: string;
}): CodeComponentConfig {
  return {
    name: "Code",
    description: "Python code block",
    parameters: [{ identifier: "code", type: "code", value: code }],
    inputs: inputs as CodeComponentConfig["inputs"],
    outputs: outputs as CodeComponentConfig["outputs"],
    ...(scenarioMappings && Object.keys(scenarioMappings).length > 0
      ? { scenarioMappings }
      : {}),
    ...(scenarioOutputField !== undefined ? { scenarioOutputField } : {}),
  };
}
