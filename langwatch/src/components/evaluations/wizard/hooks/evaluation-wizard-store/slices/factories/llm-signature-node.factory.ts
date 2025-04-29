import type { NodeWithOptionalPosition } from "../../../../../../../types";
import { DEFAULT_MODEL } from "../../../../../../../utils/constants";

import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";

type LlmSignatureNode = Omit<
  NodeWithOptionalPosition<LlmPromptConfigComponent>,
  "data"
> & {
  data: Omit<LlmPromptConfigComponent, "configId">;
};

const DEFAULT_SIGNATURE_NODE_PROPERTIES = (
  model: string
): LlmSignatureNode => ({
  type: "signature",
  id: "llm_node",
  deletable: false,
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
        identifier: "demonstrations",
        type: "dataset" as const,
        value: {
          columns: [
            {
              name: "Input",
              type: "string",
            },
            {
              name: "Output",
              type: "string",
            },
          ],
          rows: [],
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
 * Simple factory for creating LLM Signature Nodes
 */
export class LlmSignatureNodeFactory {
  static build(
    overrides?: Partial<LlmSignatureNode>,
    project?: { defaultModel?: string | null }
  ): LlmSignatureNode {
    return {
      ...DEFAULT_SIGNATURE_NODE_PROPERTIES(
        project?.defaultModel ?? DEFAULT_MODEL
      ),
      ...overrides,
    };
  }
}
