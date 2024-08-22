import { HStack, Text, VStack } from "@chakra-ui/react";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { type Component, type Field } from "../types/dsl";
import { EntryIcon, SignatureIcon } from "./ColorfulBlockIcons";

export function SignatureNode(props: NodeProps<Node<Component>>) {
  return <ComponentNode icon={<SignatureIcon />} {...props} />;
}

export function EntryNode(props: NodeProps<Node<Component>>) {
  return <ComponentNode icon={<EntryIcon />} {...props} />;
}

function NodeInputs({
  namespace,
  inputs,
}: {
  namespace: string;
  inputs: Field[];
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
              boxShadow: `0px 0px 4px 0px #FF8309`,
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
}: {
  namespace: string;
  outputs: Field[];
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
              boxShadow: `0px 0px 4px 0px #2B6CB0`,
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

function TypeLabel({ type }: { type: string }) {
  return (
    <Text color="cyan.600" fontStyle="italic">
      {type}
    </Text>
  );
}

function NodeSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text
      fontSize={9}
      textTransform="uppercase"
      color="gray.500"
      fontWeight="bold"
    >
      {children}
    </Text>
  );
}

function ComponentNode(
  props: NodeProps<Node<Component>> & {
    icon: React.ReactNode;
    children?: React.ReactNode;
  }
) {
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
    >
      <HStack spacing="auto">
        <HStack spacing={2}>
          {props.icon}
          <Text fontSize={12}>
            {props.data.name ?? props.data.cls ?? props.id}
          </Text>
        </HStack>
      </HStack>
      {props.children}
      {props.data.inputs && (
        <>
          <NodeSectionTitle>Inputs</NodeSectionTitle>
          <NodeInputs namespace="inputs" inputs={props.data.inputs} />
        </>
      )}
      {props.data.outputs && (
        <>
          <NodeSectionTitle>Outputs</NodeSectionTitle>
          <NodeOutputs namespace="outputs" outputs={props.data.outputs} />
        </>
      )}
    </VStack>
  );
}
