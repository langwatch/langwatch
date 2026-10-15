import type { AgentConfig, CodeAgentConfig } from "./config/index.ts";
import type { AgentInputBinding, Field } from "./fields.ts";

export const DEFAULT_CODE = `class Code:
    def __call__(self, input: str):
        # Your code goes here

        return {"output": input.upper()}
`;

export function getCodeFromConfig(config: AgentConfig): string {
  if (!("parameters" in config)) return DEFAULT_CODE;

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

/** The keys the code agent editor writes; every other stored key is the editor's to keep. */
const CODE_EDITOR_KEYS = [
  "name",
  "description",
  "parameters",
  "inputs",
  "outputs",
  "scenarioMappings",
  "scenarioOutputField",
] as const;

/**
 * An edited code config over the stored one: what the editor wrote wins, and what it does not
 * edit (a timeout, a library reference, a parameter other than the code) stays as stored.
 */
export function codeConfigKeepingStored({
  stored,
  edited,
}: {
  stored: CodeAgentConfig | undefined;
  edited: CodeAgentConfig;
}): CodeAgentConfig {
  if (!stored) return edited;

  const kept: Partial<CodeAgentConfig> = { ...stored };
  for (const key of CODE_EDITOR_KEYS) delete kept[key];
  const editedIds = new Set(edited.parameters.map((parameter) => parameter.identifier));
  const otherParameters = stored.parameters.filter(
    (parameter) => !editedIds.has(parameter.identifier),
  );

  return {
    ...kept,
    ...edited,
    parameters: [...edited.parameters, ...otherParameters],
  };
}
