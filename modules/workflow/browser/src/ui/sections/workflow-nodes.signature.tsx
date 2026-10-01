import type { Signature } from "@langwatch/workflow-contract";
import type { Node, NodeProps } from "@xyflow/react";
import { forwardRef, type Ref } from "react";

import {
  PromptingTechniqueDropArea,
  PromptingTechniqueWrapper,
} from "./workflow-nodes.prompting-technique.tsx";
import { ComponentNode } from "./workflow-nodes.tsx";

const isPromptingTechniqueReference = (value: unknown): value is { ref: string } =>
  typeof value === "object" && value !== null && "ref" in value && typeof value.ref === "string";

/**
 * LLM calling node based on DSPy signatures with configurable model and prompting techniques.
 * Used in optimization studio to construct LLM-powered workflows.
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
        isPromptingTechniqueReference(promptingTechniqueValue) ? promptingTechniqueValue : void 0
      }
    >
      <PromptingTechniqueDropArea id={props.id}>
        <ComponentNode ref={ref} {...props} />
      </PromptingTechniqueDropArea>
    </PromptingTechniqueWrapper>
  );
});
