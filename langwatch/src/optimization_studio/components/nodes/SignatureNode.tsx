import { type Node, type NodeProps } from "@xyflow/react";
import { forwardRef, type Ref } from "react";
import type { Signature } from "../../types/dsl";
import { ComponentNode } from "./Nodes";
import {
  PromptingTechniqueDropArea,
  PromptingTechniqueWrapper,
} from "./PromptingTechniqueNode";

/**
 * SignatureNode represents an LLM calling node in the workflow editor.
 *
 * It's based on the concept of signature from DSPy, which defines the interface
 * for LLM interactions with inputs, outputs, and parameters.
 *
 * This node can:
 * - Be configured with an LLM model
 * - Have instructions for the LLM
 * - Include demonstrations (few-shot examples)
 * - Be wrapped with a prompting technique (like Chain of Thought)
 *
 * The node is used in the optimization studio to visually construct
 * LLM-powered workflows where users can connect it with other components.
 */
export const SignatureNode = forwardRef(function SignatureNode(
  props: NodeProps<Node<Signature>>,
  ref: Ref<HTMLDivElement>
) {
  const parameters = Object.fromEntries(
    props.data.parameters?.map((p) => [p.identifier, p]) ?? []
  );

  return (
    <PromptingTechniqueWrapper
      decoratedBy={
        parameters.prompting_technique?.value as { ref: string } | undefined
      }
    >
      <PromptingTechniqueDropArea id={props.id}>
        <ComponentNode ref={ref} {...props} />
      </PromptingTechniqueDropArea>
    </PromptingTechniqueWrapper>
  );
});
