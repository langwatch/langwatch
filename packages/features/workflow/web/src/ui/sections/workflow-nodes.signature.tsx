import type { Node, NodeProps } from "@xyflow/react";
import { forwardRef, type Ref } from "react";
import type { Signature } from "@langwatch/workflow-contract";
import { ComponentNode } from "./workflow-nodes";
import {
  PromptingTechniqueDropArea,
  PromptingTechniqueWrapper,
} from "./workflow-nodes.prompting-technique";

const isPromptingTechniqueReference = (value: unknown): value is { ref: string } =>
  typeof value === "object" &&
  value !== null &&
  "ref" in value &&
  typeof value.ref === "string";

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
  ref: Ref<HTMLDivElement>,
) {
  const promptingTechniqueValue = props.data.parameters?.find(
    (parameter) => parameter.identifier === "prompting_technique",
  )?.value;

  return (
    <PromptingTechniqueWrapper
      decoratedBy={
        isPromptingTechniqueReference(promptingTechniqueValue)
          ? promptingTechniqueValue
          : void 0
      }
    >
      <PromptingTechniqueDropArea id={props.id}>
        <ComponentNode ref={ref} {...props} />
      </PromptingTechniqueDropArea>
    </PromptingTechniqueWrapper>
  );
});
