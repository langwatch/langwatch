import { Box, HStack, Text, useDisclosure, VStack } from "@chakra-ui/react";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import {
  type Component,
  type ComponentType,
  type Entry,
  type Field,
} from "../types/dsl";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { ComponentIcon } from "./ColorfulBlockIcons";
import {
  DatasetModal,
  DatasetPreview,
  useGetDatasetData,
} from "./DatasetModal";
import { useState, useEffect } from "react";

export function SignatureNode(props: NodeProps<Node<Component>>) {
  return <ComponentNode {...props} />;
}

export function EntryNode(props: NodeProps<Node<Component>>) {
  const [rendered, setRendered] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();

  useEffect(() => {
    setRendered(true);
  }, []);

  const { rows } = useGetDatasetData(props.data, 5, 4) ?? {};

  return (
    <ComponentNode {...props} outputsName="Fields">
      <NodeSectionTitle>Dataset</NodeSectionTitle>
      <Box
        width="200%"
        transform="scale(0.5)"
        transformOrigin="top left"
        height={`${(34 + 28 * (rows?.length ?? 0)) / 2}px`}
      >
        {rendered && (
          <DatasetPreview data={props.data as Entry} onClick={onOpen} />
        )}
      </Box>
      <DatasetModal isOpen={isOpen} onClose={onClose} node={props} />
    </ComponentNode>
  );
}

export function getNodeDisplayName(node: { id: string; data: Component }) {
  return node.data.name ?? node.data.cls ?? node.id;
}

function NodeInputs({
  namespace,
  inputs,
  selected,
}: {
  namespace: string;
  inputs: Field[];
  selected: boolean;
}) {
  return (
    <>
      {inputs.map((input) => (
        <HStack
          key={input.identifier}
          spacing={1}
          paddingX={2}
          paddingY={1}
          background="gray.100"
          borderRadius="8px"
          width="full"
          position="relative"
        >
          <Handle
            type="target"
            id={`${namespace}.${input.identifier}`}
            position={Position.Left}
            style={{
              marginLeft: "-10px",
              width: "8px",
              height: "8px",
              background: "white",
              borderRadius: "100%",
              border: `1px solid #FF8309`,
              boxShadow: `0px 0px ${selected ? "4px" : "2px"} 0px #FF8309`,
            }}
          />
          <Text>{input.identifier}</Text>
          <Text color="gray.400">:</Text>
          <TypeLabel type={input.type} />
        </HStack>
      ))}
    </>
  );
}

function NodeOutputs({
  namespace,
  outputs,
  selected,
}: {
  namespace: string;
  outputs: Field[];
  selected: boolean;
}) {
  return (
    <>
      {outputs.map((output) => (
        <HStack
          key={output.identifier}
          spacing={1}
          paddingX={2}
          paddingY={1}
          background="gray.100"
          borderRadius="8px"
          width="full"
          position="relative"
        >
          <Handle
            type="source"
            id={`${namespace}.${output.identifier}`}
            position={Position.Right}
            style={{
              marginRight: "-10px",
              width: "8px",
              height: "8px",
              background: "white",
              borderRadius: "100%",
              border: `1px solid #2B6CB0`,
              boxShadow: `0px 0px ${selected ? "4px" : "2px"} 0px #2B6CB0`,
            }}
          />
          <Text>{output.identifier}</Text>
          <Text color="gray.400">:</Text>
          <TypeLabel type={output.type} />
        </HStack>
      ))}
    </>
  );
}

export function TypeLabel({ type }: { type: string }) {
  return (
    <Text color="cyan.600" fontStyle="italic">
      {type}
    </Text>
  );
}

export function NodeSectionTitle({
  fontSize,
  children,
}: {
  fontSize?: number;
  children: React.ReactNode;
}) {
  return (
    <Text
      fontSize={fontSize ?? 9}
      textTransform="uppercase"
      color="gray.500"
      fontWeight="bold"
      paddingTop={1}
    >
      {children}
    </Text>
  );
}

export const selectionColor = "#2F8FFB";

function ComponentNode(
  props: NodeProps<Node<Component>> & {
    icon?: React.ReactNode;
    children?: React.ReactNode;
    outputsName?: string;
  }
) {
  const { hoveredNodeId, setHoveredNodeId } = useWorkflowStore(
    ({ hoveredNodeId, setHoveredNodeId }) => ({
      hoveredNodeId,
      setHoveredNodeId,
    })
  );
  const isHovered = hoveredNodeId === props.id;

  return (
    <VStack
      borderRadius="12px"
      background="white"
      padding="10px"
      spacing={2}
      align="start"
      color="gray.600"
      fontSize={11}
      minWidth="160px"
      boxShadow={`0px 0px 4px 0px rgba(0, 0, 0, ${isHovered ? "0.2" : "0.05"})`}
      border="none"
      outline={!!props.selected || isHovered ? "1.5px solid" : "none"}
      outlineColor={
        props.selected ? selectionColor : isHovered ? "gray.300" : "none"
      }
      onMouseEnter={() => setHoveredNodeId(props.id)}
      onMouseLeave={() => setHoveredNodeId(undefined)}
    >
      <HStack spacing="auto">
        <HStack spacing={2}>
          <ComponentIcon type={props.type as ComponentType} size="md" />
          <Text fontSize={12} fontWeight={500}>
            {getNodeDisplayName(props)}
          </Text>
        </HStack>
      </HStack>
      {props.data.inputs && (
        <>
          <NodeSectionTitle>Inputs</NodeSectionTitle>
          <NodeInputs
            namespace="inputs"
            inputs={props.data.inputs}
            selected={!!props.selected || isHovered}
          />
        </>
      )}
      {props.data.outputs && (
        <>
          <NodeSectionTitle>{props.outputsName ?? "Outputs"}</NodeSectionTitle>
          <NodeOutputs
            namespace="outputs"
            outputs={props.data.outputs}
            selected={!!props.selected || isHovered}
          />
        </>
      )}
      {props.children}
    </VStack>
  );
}
