import type {
  AgentConfig,
  AgentInputBinding,
  CodeAgentConfig,
  Field,
} from "@langwatch/agent-contract";

export const DEFAULT_CODE = `class Code:
    def __call__(self, input: str):
        # Your code goes here

        return {"output": input.upper()}
`;

export function getCodeFromConfig(config: AgentConfig): string {
  const parameter = config.parameters?.find(
    (field) => "identifier" in field && field.identifier === "code" && field.type === "code",
  );

  return parameter && "value" in parameter && typeof parameter.value === "string"
    ? parameter.value
    : DEFAULT_CODE;
}

export function buildCodeConfig(input: {
  code: string;
  inputs: Field[];
  outputs: Field[];
  scenarioMappings?: Record<string, AgentInputBinding>;
  scenarioOutputField?: string;
}): CodeAgentConfig {
  return {
    name: "Code",
    description: "Python code block",
    parameters: [{ identifier: "code", type: "code", value: input.code }],
    inputs: input.inputs,
    outputs: input.outputs,
    ...(input.scenarioMappings && Object.keys(input.scenarioMappings).length > 0
      ? { scenarioMappings: input.scenarioMappings }
      : {}),
    ...(input.scenarioOutputField !== void 0
      ? { scenarioOutputField: input.scenarioOutputField }
      : {}),
  };
}
