import { type Node, type NodeProps } from "@xyflow/react";
import { LLMModelDisplay } from "../properties/modals/LLMConfigModal";
import { ComponentNode, NodeSectionTitle } from "./Nodes";
import type { Signature } from "../../types/dsl";
import { HStack } from "@chakra-ui/react";

export function SignatureNode(props: NodeProps<Node<Signature>>) {
  return (
    <ComponentNode {...props}>
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
  );
}
