import { forwardRef, HStack } from "@chakra-ui/react";
import { type Node, type NodeProps } from "@xyflow/react";
import type { Ref } from "react";
import type { Signature } from "../../types/dsl";
import { LLMModelDisplay } from "../properties/modals/LLMConfigModal";
import { ComponentNode, NodeSectionTitle } from "./Nodes";
import {
  PromptingTechniqueDropArea,
  PromptingTechniqueWrappers,
} from "./PromptingTechniqueNode";

export const SignatureNode = forwardRef(function SignatureNode(
  props: NodeProps<Node<Signature>>,
  ref: Ref<HTMLDivElement>
) {
  return (
    <PromptingTechniqueWrappers decoratedBy={props.data.decorated_by}>
      <PromptingTechniqueDropArea id={props.id}>
        <ComponentNode ref={ref} {...props}>
          {props.data.llm && (
            <>
              <NodeSectionTitle>LLM</NodeSectionTitle>
              <HStack width="full">
                <LLMModelDisplay
                  model={props.data.llm.model}
                  fontSize={11}
                  showVersion={false}
                />
              </HStack>
            </>
          )}
        </ComponentNode>
      </PromptingTechniqueDropArea>
    </PromptingTechniqueWrappers>
  );
});
