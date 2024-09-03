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
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Columns, Folder, X } from "react-feather";
import { useWindowSize } from "usehooks-ts";
import { useShallow } from "zustand/react/shallow";
import { DatasetPreview } from "../../components/datasets/DatasetPreview";
import { useGetDatasetData } from "../hooks/useGetDatasetData";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Component, ComponentType, Entry, Field } from "../types/dsl";
import { ComponentIcon } from "./ColorfulBlockIcons";
import { InputPanel } from "./component_execution/InputPanel";
import { OutputPanel } from "./component_execution/OutputPanel";
import { DatasetModal } from "./DatasetModal";
import {
  ComponentExecutionButton,
  getNodeDisplayName,
  isExecutableComponent,
  NodeSectionTitle,
  TypeLabel,
} from "./Nodes";

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
            onClick={() => {
              if (propertiesExpanded) {
                setPropertiesExpanded(false);
              } else {
                deselectAllNodes();
              }
            }}
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

  const { width, height } = useWindowSize();

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedNode) {
      setPropertiesExpanded(false);
    }
  }, [selectedNode, setPropertiesExpanded]);

  if (!selectedNode || !width) {
    return null;
  }

  const PropertiesPanel =
    ComponentPropertiesPanelMap[selectedNode.type as ComponentType];

  const panelWidth = ref.current?.offsetWidth ?? 350;
  const halfPanelWidth = Math.round(panelWidth / 2);
  const middlePoint = Math.round(width / 2 - halfPanelWidth);
  const topPanelHeight = 41;
  const fullPanelHeight = height - topPanelHeight;

  // TODO: close on X if expanded

  return (
    <Box>
      <Box
        as={motion.div}
        initial={{
          right: 0,
          height: `${fullPanelHeight}px`,
          marginTop: 0,
          borderRadius: 0,
          borderTopWidth: 0,
          borderBottomWidth: 0,
          borderRightWidth: 0,
          boxShadow: "0 0 0 rgba(0,0,0,0)",
        }}
        animate={{
          right: propertiesExpanded ? `${middlePoint}px` : 0,
          height: propertiesExpanded
            ? `${fullPanelHeight - 40}px`
            : `${fullPanelHeight}px`,
          marginTop: propertiesExpanded ? "20px" : 0,
          borderRadius: propertiesExpanded ? "8px" : 0,
          borderTopWidth: propertiesExpanded ? "1px" : 0,
          borderBottomWidth: propertiesExpanded ? "1px" : 0,
          borderRightWidth: propertiesExpanded ? "1px" : 0,
          boxShadow: propertiesExpanded
            ? "0 0 10px rgba(0,0,0,0.1)"
            : "0 0 0 rgba(0,0,0,0)",
        }}
        transition="0.05s ease-out"
        ref={ref}
        position="absolute"
        top={0}
        right={0}
        background="white"
        border="1px solid"
        borderColor="gray.350"
        zIndex={100}
      >
        <PropertiesPanel node={selectedNode} />
      </Box>
      {propertiesExpanded && (
        <>
          <Box
            className="fade-in"
            position="absolute"
            top={0}
            left={0}
            height="100%"
            width="100%"
            background="rgba(0,0,0,0.1)"
            zIndex={98}
          />
          <Box
            position="absolute"
            top={0}
            left={0}
            height="100%"
            width={`calc(50% - ${halfPanelWidth}px)`}
            overflow="hidden"
            zIndex={99}
          >
            <Box
              as={motion.div}
              width="100%"
              height="100%"
              initial={{ x: "100%" }}
              animate={{ x: "0%" }}
              transition="0.1s ease-out 0.05s"
              paddingY="40px"
              paddingLeft="40px"
            >
              <InputPanel node={selectedNode} />
            </Box>
          </Box>
          <Box
            position="absolute"
            top={0}
            right={0}
            height="100%"
            width={`calc(50% - ${halfPanelWidth}px)`}
            overflow="hidden"
            zIndex={99}
          >
            <Box
              as={motion.div}
              width="100%"
              height="100%"
              initial={{ x: "-100%" }}
              animate={{ x: "0%" }}
              transition="0.1s ease-out 0.05s"
              paddingY="40px"
              paddingRight="40px"
            >
              <OutputPanel node={selectedNode} />
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
