import {
  buildLlmSignatureNode,
  type LlmPromptConfigComponent,
  type NodeWithOptionalPosition,
} from "@langwatch/workflow-contract";

type LlmSignatureNode = NodeWithOptionalPosition<LlmPromptConfigComponent>;

/** Browser facade for creating the default Studio LLM signature node. */
export class LlmSignatureNodeFactory {
  static build(overrides?: Partial<LlmSignatureNode>, defaultModel?: string): LlmSignatureNode {
    return buildLlmSignatureNode(overrides, defaultModel);
  }
}
