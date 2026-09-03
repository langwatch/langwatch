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

/**
 * The source a code agent carries, or the starter when it carries none.
 *
 * `AgentConfig` is a union across every agent kind, and a CONNECTED agent's
 * `parameters` are what a decorated function declares — `{name, type: "text" |
 * "number" | "boolean"}` — with no `identifier` and no `value` at all. So the
 * `code` parameter is looked for by shape rather than assumed: a config of a
 * kind that has no source falls through to the starter, which is what every
 * other caller of this already expects from an agent with an empty body.
 */
export function getCodeFromConfig(config: AgentComponentConfig): string;
export function getCodeFromConfig(config: AgentComponentConfig): unknown {
  const codeParameter = config.parameters?.find(
    (parameter) =>
      "identifier" in parameter && parameter.identifier === "code" && parameter.type === "code",
  );

  return (codeParameter && "value" in codeParameter ? codeParameter.value : void 0) ?? DEFAULT_CODE;
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
    ...(scenarioMappings && Object.keys(scenarioMappings).length > 0 ? { scenarioMappings } : {}),
    ...(scenarioOutputField !== void 0 ? { scenarioOutputField } : {}),
  };
}
