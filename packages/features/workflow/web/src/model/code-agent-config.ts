import type {
  AgentConfig as AgentComponentConfig,
  AgentInputBinding,
} from "@langwatch/agent-contract";
import type { CodeComponentConfig, Field } from "@langwatch/workflow-contract";

/** Default Python source shown when a new code agent is created. */
export const DEFAULT_CODE = `class Code:
    def __call__(self, input: str):
        # Your code goes here

        return {"output": input.upper()}
`;

export function getCodeFromConfig(config: AgentComponentConfig): string;
export function getCodeFromConfig(config: AgentComponentConfig): unknown {
  const codeParameter = config.parameters?.find(
    (parameter) => parameter.identifier === "code" && parameter.type === "code",
  );

  return codeParameter?.value ?? DEFAULT_CODE;
}

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
  scenarioMappings?: Record<string, AgentInputBinding>;
  scenarioOutputField?: string;
}): CodeComponentConfig {
  return {
    name: "Code",
    description: "Python code block",
    parameters: [{ identifier: "code", type: "code", value: code }],
    inputs,
    outputs,
    ...(scenarioMappings && Object.keys(scenarioMappings).length > 0
      ? { scenarioMappings }
      : {}),
    ...(scenarioOutputField !== void 0 ? { scenarioOutputField } : {}),
  };
}
