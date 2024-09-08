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
import { ChevronDown, Columns, X } from "react-feather";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type {
  Component,
  ComponentType,
  Field,
  Workflow,
} from "../../types/dsl";
import { ComponentIcon } from "../ColorfulBlockIcons";
import {
  ComponentExecutionButton,
  getNodeDisplayName,
  isExecutableComponent,
  NodeSectionTitle,
  TypeLabel,
} from "../nodes/Nodes";

export function PropertyField({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <VStack align="start" spacing={3} width="full">
      <PropertySectionTitle>{title}</PropertySectionTitle>
      {children}
    </VStack>
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

export function PropertySectionTitle({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Box paddingLeft={2}>
      <NodeSectionTitle fontSize={13}>{children}</NodeSectionTitle>
    </Box>
  );
}

export function BasePropertiesPanel({
  node,
  header,
  children,
  fieldsAfter,
}: {
  node: Node<Component> | Workflow;
  header?: React.ReactNode;
  children?: React.ReactNode;
  fieldsAfter?: React.ReactNode;
}) {
  const { deselectAllNodes, propertiesExpanded, setPropertiesExpanded } =
    useWorkflowStore(
      useShallow((state) => ({
        deselectAllNodes: state.deselectAllNodes,
        propertiesExpanded: state.propertiesExpanded,
        setPropertiesExpanded: state.setPropertiesExpanded,
      }))
    );

  const isWorkflow = (node: Node<Component> | Workflow): node is Workflow =>
    !("data" in node);

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
          {header ? (
            header
          ) : !isWorkflow(node) ? (
            <>
              <ComponentIcon type={node.type as ComponentType} size="lg" />
              <Text fontSize={16} fontWeight={500}>
                {getNodeDisplayName(node)}
              </Text>
            </>
          ) : null}
        </HStack>
        <Spacer />
        <HStack spacing={0} marginRight="-4px">
          {!isWorkflow(node) && isExecutableComponent(node) && (
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
      {children}
      {!isWorkflow(node) && (
        <>
          <PropertyFields
            title="Parameters"
            fields={node.data.parameters ?? []}
          />
          <PropertyFields title="Inputs" fields={node.data.inputs ?? []} />
          <PropertyFields title="Outputs" fields={node.data.outputs ?? []} />
        </>
      )}
      {fieldsAfter}
    </VStack>
  );
}
