import type {
  LlmPromptConfigComponent,
  NodeDataset,
} from "~/optimization_studio/types/dsl";
import type { NodeWithOptionalPosition } from "../../types";

type LlmSignatureNode = NodeWithOptionalPosition<LlmPromptConfigComponent>;

const DEFAULT_SIGNATURE_NODE_PROPERTIES = (
  model: string,
): LlmSignatureNode => ({
  type: "signature",
  id: "llm_node",
  data: {
    name: "LLM Node",
    description: "LLM calling node",
    parameters: [
      {
        identifier: "llm",
        type: "llm" as const,
        value: {
          model,
        },
      },
      {
        identifier: "prompting_technique",
        type: "prompting_technique" as const,
        value: undefined,
      },
      {
        identifier: "instructions",
        type: "str" as const,
        value: "You are a helpful assistant.",
      },
      {
        identifier: "messages",
        type: "chat_messages" as const,
        value: [
          {
            role: "user",
            content: "{{input}}",
          },
        ],
      },
      {
        identifier: "demonstrations",
        type: "dataset" as const,
        value: {
          inline: {
            records: {
              input: [],
              output: [],
            },
            columnTypes: [
              {
                name: "input",
                type: "string",
              },
              {
                name: "output",
                type: "string",
              },
            ],
          },
        },
      },
    ],
    inputs: [
      {
        identifier: "input",
        type: "str" as const,
      },
    ],
    outputs: [
      {
        identifier: "output",
        type: "str" as const,
      },
    ],
  },
});

/**
 * Simple factory for creating LLM Signature Nodes.
 *
 * Caller supplies the resolved default model (post-system-tier removal
 * the cascade can return nothing, in which case an empty string is the
 * correct hand-off — the LLM-node UI surfaces the missing default at
 * the first run via the MissingModelToast interceptor instead of
 * masking the gap with a constant).
 */
export class LlmSignatureNodeFactory {
  static build(
    overrides?: Partial<LlmSignatureNode>,
    defaultModel?: string,
  ): LlmSignatureNode {
    return {
      ...DEFAULT_SIGNATURE_NODE_PROPERTIES(defaultModel ?? ""),
      ...overrides,
    };
  }
}
