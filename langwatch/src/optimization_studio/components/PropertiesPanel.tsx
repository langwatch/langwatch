import {
  Box,
  Button,
  HStack,
  Select,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { ChevronDown, Edit2, X } from "react-feather";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Component, ComponentType, Entry, Field } from "../types/dsl";
import { ComponentIcon } from "./ColorfulBlockIcons";
import { DatasetPreview } from "./DatasetModal";
import { getNodeDisplayName, NodeSectionTitle, TypeLabel } from "./Nodes";

export function EntryPointPropertiesPanel({ node }: { node: Node<Component> }) {
  return (
    <BasePropertiesPanel node={node}>
      <HStack width="full">
        <PropertySectionTitle>Dataset</PropertySectionTitle>
        <Spacer />
        <Button size="xs" variant="ghost" leftIcon={<Edit2 size={14} />}>
          <Text>Edit</Text>
        </Button>
      </HStack>
      <DatasetPreview data={node.data as Entry} />
    </BasePropertiesPanel>
  );
}

export function PropertyFields({
  title,
  fields,
}: {
  title: string;
  fields: Field[];
}) {
  if (fields.length === 0) {
    return null;
  }

  return (
    <VStack align="start" spacing={3} width="full">
      <PropertySectionTitle>{title}</PropertySectionTitle>
      {fields.map((field) => (
        <HStack
          key={field.identifier}
          background="gray.100"
          padding="6px 8px 6px 12px"
          borderRadius="8px"
          width="full"
        >
          <Text fontFamily="monospace" fontSize={14}>
            {field.identifier}
          </Text>
          <Spacer />
          <HStack
            position="relative"
            background="white"
            borderRadius="8px"
            paddingX={2}
            paddingY={1}
            spacing={2}
            height="full"
          >
            <Box fontSize={13}>
              <TypeLabel type={field.type} />
            </Box>
            <Box color="gray.600">
              <ChevronDown size={14} />
            </Box>
            <Select
              opacity={0}
              position="absolute"
              top={0}
              left={0}
              width="100%"
              height="32px"
              icon={<></>}
            >
              <option value={field.type}>{field.type}</option>
            </Select>
          </HStack>
        </HStack>
      ))}
    </VStack>
  );
}

function PropertySectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Box paddingLeft={2}>
      <NodeSectionTitle fontSize={13}>{children}</NodeSectionTitle>
    </Box>
  );
}

export function BasePropertiesPanel({
  node,
  children,
}: {
  node: Node<Component>;
  children?: React.ReactNode;
}) {
  const { deselectAllNodes } = useWorkflowStore(
    useShallow((state) => ({
      deselectAllNodes: state.deselectAllNodes,
    }))
  );

  return (
    <VStack
      align="start"
      spacing={6}
      padding={3}
      maxWidth="550px"
      width="25vw"
      minWidth="350px"
      height="full"
      background="white"
      borderLeft="1px solid"
      borderColor="gray.350"
    >
      <HStack paddingY={1} paddingLeft={2} width="full" justify="space-between">
        <HStack spacing={3}>
          <ComponentIcon type={node.type as ComponentType} size="lg" />
          <Text fontSize={16} fontWeight={500}>
            {getNodeDisplayName(node)}
          </Text>
        </HStack>
        <HStack spacing={3}>
          <Button
            variant="ghost"
            size="xs"
            color="gray.500"
            onClick={deselectAllNodes}
          >
            <X size={14} />
          </Button>
        </HStack>
      </HStack>
      <PropertyFields title="Parameters" fields={node.data.parameters ?? []} />
      <PropertyFields title="Inputs" fields={node.data.inputs ?? []} />
      <PropertyFields title="Outputs" fields={node.data.outputs ?? []} />
      {children}
    </VStack>
  );
}

export function PropertiesPanel() {
  const { selectedNode } = useWorkflowStore(
    useShallow((state) => ({
      selectedNode: state.nodes.find((n) => n.selected),
    }))
  );

  const ComponentPropertiesPanelMap: Record<
    ComponentType,
    React.FC<{ node: Node<Component> }>
  > = {
    entry: EntryPointPropertiesPanel,
    signature: BasePropertiesPanel,
    module: BasePropertiesPanel,
    retriever: BasePropertiesPanel,
    prompting_technique: BasePropertiesPanel,
    evaluator: BasePropertiesPanel,
  };

  if (!selectedNode) {
    return null;
  }

  const PropertiesPanel =
    ComponentPropertiesPanelMap[selectedNode.type as ComponentType];

  return (
    <Box position="absolute" top={0} right={0} height="full" zIndex={100}>
      <PropertiesPanel node={selectedNode} />
    </Box>
  );
}
