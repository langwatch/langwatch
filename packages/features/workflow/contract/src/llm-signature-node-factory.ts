import type { LlmPromptConfigComponent } from "./studio-workflow";
import type { NodeWithOptionalPosition } from "./studio-workflow-node-utils";

type LlmSignatureNode = NodeWithOptionalPosition<LlmPromptConfigComponent>;

const defaultSignatureNode = (model: string): LlmSignatureNode => ({
  type: "signature",
  id: "llm_node",
  data: {
    name: "LLM Node",
    description: "LLM calling node",
    parameters: [
      { identifier: "llm", type: "llm", value: { model } },
      {
        identifier: "prompting_technique",
        type: "prompting_technique",
        value: void 0,
      },
      {
        identifier: "instructions",
        type: "str",
        value: "You are a helpful assistant.",
      },
      {
        identifier: "messages",
        type: "chat_messages",
        value: [{ role: "user", content: "{{input}}" }],
      },
      {
        identifier: "demonstrations",
        type: "dataset",
        value: {
          inline: {
            records: { input: [], output: [] },
            columnTypes: [
              { name: "input", type: "string" },
              { name: "output", type: "string" },
            ],
          },
        },
      },
    ],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  },
});

/** Creates the portable default LLM signature node used by browser and API callers. */
export function buildLlmSignatureNode(
  overrides?: Partial<LlmSignatureNode>,
  defaultModel?: string,
): LlmSignatureNode {
  return {
    ...defaultSignatureNode(defaultModel ?? ""),
    ...overrides,
  };
}
