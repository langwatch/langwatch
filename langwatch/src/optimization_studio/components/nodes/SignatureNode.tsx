import { forwardRef, HStack } from "@chakra-ui/react";
import { type Node, type NodeProps } from "@xyflow/react";
import type { Ref } from "react";
import type { LLMConfig, Signature } from "../../types/dsl";
import { LLMModelDisplay } from "../properties/modals/LLMConfigModal";
import { ComponentNode, NodeSectionTitle } from "./Nodes";
import {
  PromptingTechniqueDropArea,
  PromptingTechniqueWrapper,
} from "./PromptingTechniqueNode";

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
        <ComponentNode ref={ref} {...props}>
          {(parameters.llm?.value as LLMConfig) && (
            <>
              <NodeSectionTitle>LLM</NodeSectionTitle>
              <HStack width="full">
                <LLMModelDisplay
                  model={(parameters.llm?.value as LLMConfig).model}
                  fontSize={11}
                  showVersion={false}
                />
              </HStack>
            </>
          )}
        </ComponentNode>
      </PromptingTechniqueDropArea>
    </PromptingTechniqueWrapper>
  );
});
