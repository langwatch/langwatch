import {
  Box,
  Button,
  HStack,
  Select,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  Columns,
  Folder,
  Maximize,
  Minimize,
  Minimize2,
  X,
} from "react-feather";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Component, ComponentType, Entry, Field } from "../types/dsl";
import { ComponentIcon } from "./ColorfulBlockIcons";
import { DatasetModal } from "./DatasetModal";
import {
  ComponentExecutionButton,
  getNodeDisplayName,
  isExecutableComponent,
  NodeSectionTitle,
  TypeLabel,
} from "./Nodes";
import { DatasetPreview } from "../../components/datasets/DatasetPreview";
import { useGetDatasetData } from "../hooks/useGetDatasetData";

export function EntryPointPropertiesPanel({ node }: { node: Node<Component> }) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [editingDataset, setEditingDataset] = useState<
    Entry["dataset"] | undefined
  >();
  const { rows, columns } = useGetDatasetData({
    dataset: "dataset" in node.data ? node.data.dataset : undefined,
    preview: true,
  });

  return (
    <BasePropertiesPanel node={node}>
      <HStack width="full">
        <PropertySectionTitle>Dataset</PropertySectionTitle>
        <Spacer />
        <Button
          size="xs"
          variant="ghost"
          marginBottom={-1}
          leftIcon={<Folder size={14} />}
          onClick={() => {
            setEditingDataset(undefined);
            onOpen();
          }}
        >
          <Text>Choose...</Text>
        </Button>
      </HStack>
      <DatasetPreview
        rows={rows}
        columns={columns.map((column) => ({
          name: column.name,
          type: "string",
        }))}
        onClick={() => {
          setEditingDataset((node.data as Entry).dataset);
          onOpen();
        }}
      />
      <DatasetModal
        isOpen={isOpen}
        onClose={onClose}
        node={node}
        editingDataset={editingDataset}
      />
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
  const { deselectAllNodes, propertiesExpanded, setPropertiesExpanded } =
    useWorkflowStore(
      useShallow((state) => ({
        deselectAllNodes: state.deselectAllNodes,
        propertiesExpanded: state.propertiesExpanded,
        setPropertiesExpanded: state.setPropertiesExpanded,
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
        <Spacer />
        <HStack spacing={0} marginRight="-4px">
          {isExecutableComponent(node) && (
            <>
              <HStack spacing={3}>
                <ComponentExecutionButton node={node} size="sm" iconSize={16} />
              </HStack>
              <Button
                variant="ghost"
                size="sm"
                color="gray.500"
                onClick={() => setPropertiesExpanded(!propertiesExpanded)}
              >
                <Columns size={16} />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            color="gray.500"
            onClick={deselectAllNodes}
          >
            <X size={16} />
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
  const { selectedNode, propertiesExpanded, setPropertiesExpanded } =
    useWorkflowStore(
      useShallow((state) => ({
        selectedNode: state.nodes.find((n) => n.selected),
        propertiesExpanded: state.propertiesExpanded,
        setPropertiesExpanded: state.setPropertiesExpanded,
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

  useEffect(() => {
    if (!selectedNode) {
      setPropertiesExpanded(false);
    }
  }, [selectedNode, setPropertiesExpanded]);

  if (!selectedNode) {
    return null;
  }

  const PropertiesPanel =
    ComponentPropertiesPanelMap[selectedNode.type as ComponentType];

  return (
    <Box
      position="absolute"
      top={0}
      right={0}
      // width="full"
      height="full"
      zIndex={100}
    >
      <PropertiesPanel node={selectedNode} />
    </Box>
  );
}
