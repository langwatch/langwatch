import {
  Box,
  Button,
  Center,
  HStack,
  Spacer,
  Spinner,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { useEffect, useState } from "react";
import { Check, Play, X } from "react-feather";
import { PulseLoader } from "react-spinners";
import { DatasetPreview } from "../../components/datasets/DatasetPreview";
import { useComponentExecution } from "../hooks/useComponentExecution";
import { useGetDatasetData } from "../hooks/useGetDatasetData";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import {
  type Component,
  type ComponentType,
  type Entry,
  type Field,
} from "../types/dsl";
import { ComponentIcon } from "./ColorfulBlockIcons";
import { DatasetModal } from "./DatasetModal";
import { useDebounceValue } from "usehooks-ts";

export function SignatureNode(props: NodeProps<Node<Component>>) {
  return <ComponentNode {...props} />;
}

export function EntryNode(props: NodeProps<Node<Component>>) {
  const [rendered, setRendered] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();

  useEffect(() => {
    setRendered(true);
  }, []);

  const { rows, columns } = useGetDatasetData({
    dataset: (props.data as Entry).dataset,
    preview: true,
  });

  return (
    <ComponentNode {...props} outputsName="Fields" hidePlayButton>
      <NodeSectionTitle>Dataset</NodeSectionTitle>
      <Box
        width="200%"
        transform="scale(0.5)"
        transformOrigin="top left"
        height={`${(34 + 28 * (rows?.length ?? 0)) / 2}px`}
      >
        {rendered && (
          <DatasetPreview
            rows={rows}
            columns={columns.map((column) => ({
              name: column.name,
              type: "string",
            }))}
            onClick={onOpen}
          />
        )}
      </Box>
      <DatasetModal
        isOpen={isOpen}
        editingDataset={(props.data as Entry).dataset}
        onClose={onClose}
        node={props}
      />
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
    hidePlayButton?: boolean;
  }
) {
  const { node, hoveredNodeId, setHoveredNodeId } =
    useWorkflowStore(({ nodes, hoveredNodeId, setHoveredNodeId }) => ({
      node: nodes.find((node) => node.id === props.id),
      hoveredNodeId,
      setHoveredNodeId,
    }));
  const isHovered = hoveredNodeId === props.id;

  const { startComponentExecution } = useComponentExecution();

  const [isWaitingLong] = useDebounceValue(
    node?.data.execution_state?.state === "waiting",
    300
  );

  return (
    <VStack
      borderRadius="12px"
      background="white"
      padding="10px"
      spacing={2}
      align="start"
      color="gray.600"
      fontSize={11}
      minWidth="180px"
      boxShadow={`0px 0px 4px 0px rgba(0, 0, 0, ${isHovered ? "0.2" : "0.05"})`}
      border="none"
      outline={!!props.selected || isHovered ? "1.5px solid" : "none"}
      outlineColor={
        props.selected ? selectionColor : isHovered ? "gray.300" : "none"
      }
      onMouseEnter={() => setHoveredNodeId(props.id)}
      onMouseLeave={() => setHoveredNodeId(undefined)}
    >
      <HStack spacing={2} width="full">
        <ComponentIcon type={props.type as ComponentType} size="md" />
        <Text fontSize={12} fontWeight={500}>
          {getNodeDisplayName(props)}
        </Text>
        <Spacer />
        <Center
          minWidth="16px"
          minHeight="16px"
          maxWidth="16px"
          maxHeight="16px"
        >
          {isWaitingLong && node?.data.execution_state?.state === "waiting" && (
            <Box marginLeft="-4px" marginRight="-4px">
              <PulseLoader size={2} speedMultiplier={0.5} />
            </Box>
          )}
          {((!isWaitingLong &&
            node?.data.execution_state?.state === "waiting") ||
            node?.data.execution_state?.state === "running") && (
            <Spinner size="xs" />
          )}
          {node?.data.execution_state?.state === "error" && (
            <Box color="red.500">
              <X size={14} />
            </Box>
          )}
          {node?.data.execution_state?.state === "success" && (
            <Box color="green.500">
              <Check size={14} />
            </Box>
          )}
        </Center>
        {!props.hidePlayButton && (
          <Button
            variant="ghost"
            size="xs"
            paddingX={0}
            marginRight="-4px"
            onClick={() => {
              node &&
                startComponentExecution({
                  node,
                  inputs: Object.fromEntries(
                    node.data.inputs?.map((input) => [
                      input.identifier,
                      "foobar",
                    ]) ?? []
                  ),
                });
            }}
          >
            <Play size={14} />
          </Button>
        )}
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
