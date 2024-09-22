import {
  Box,
  Button,
  Center,
  HStack,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spacer,
  Spinner,
  Text,
  Tooltip,
  VStack,
  type ButtonProps,
} from "@chakra-ui/react";

import {
  Handle,
  NodeToolbar,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Check, Play, Square, X } from "react-feather";
import { PulseLoader } from "react-spinners";
import { useDebounceValue } from "usehooks-ts";
import { useComponentExecution } from "../../hooks/useComponentExecution";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import {
  type Component,
  type ComponentType,
  type Field,
} from "../../types/dsl";
import { ComponentIcon } from "../ColorfulBlockIcons";
import { useWorkflowExecution } from "../../hooks/useWorkflowExecution";

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
  hideOutputHandles,
}: {
  namespace: string;
  outputs: Field[];
  selected: boolean;
  hideOutputHandles?: boolean;
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
          {!hideOutputHandles && (
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
          )}
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

export const isExecutableComponent = (node: Pick<Node<Component>, "type">) => {
  return node.type !== "entry" && node.type !== "prompting_technique";
};

export function ComponentNode(
  props: NodeProps<Node<Component>> & {
    icon?: React.ReactNode;
    children?: React.ReactNode;
    fieldsAfter?: React.ReactNode;
    outputsName?: string;
    hidePlayButton?: boolean;
    hideOutputHandles?: boolean;
  }
) {
  const {
    node,
    hoveredNodeId,
    setHoveredNodeId,
    setSelectedNode,
    setPropertiesExpanded,
  } = useWorkflowStore(
    ({
      nodes,
      hoveredNodeId,
      setHoveredNodeId,
      setSelectedNode,
      setPropertiesExpanded,
    }) => ({
      node: nodes.find((node) => node.id === props.id),
      hoveredNodeId,
      setHoveredNodeId,
      setSelectedNode,
      setPropertiesExpanded,
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
      minWidth="180px"
      boxShadow={`0px 0px 4px 0px rgba(0, 0, 0, ${isHovered ? "0.2" : "0.05"})`}
      border="none"
      outline={!!props.selected || isHovered ? "1.5px solid" : "none"}
      outlineColor={
        props.selected ? selectionColor : isHovered ? "gray.300" : "none"
      }
      onMouseEnter={() => setHoveredNodeId(props.id)}
      onMouseLeave={() => setHoveredNodeId(undefined)}
      onDoubleClick={() => {
        setSelectedNode(props.id);
        if (node && isExecutableComponent(node)) {
          setPropertiesExpanded(true);
        }
      }}
    >
      <HStack spacing={2} width="full">
        <ComponentIcon
          type={props.type as ComponentType}
          cls={props.data.cls}
          size="md"
        />
        <Text fontSize={12} fontWeight={500}>
          {getNodeDisplayName(props)}
        </Text>
        <Spacer />
        {node && isExecutableComponent(node) && (
          <ComponentExecutionButton
            node={node}
            marginRight="-6px"
            marginLeft="-4px"
          />
        )}
      </HStack>
      {props.children}
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
            hideOutputHandles={props.hideOutputHandles}
          />
        </>
      )}
      {props.fieldsAfter}
    </VStack>
  );
}

export function ComponentExecutionButton({
  node,
  iconSize = 14,
  componentOnly = false,
  ...props
}: {
  node: Node<Component>;
  iconSize?: number;
  componentOnly?: boolean;
} & ButtonProps) {
  const { startComponentExecution, stopComponentExecution } =
    useComponentExecution();

  const { startWorkflowExecution } = useWorkflowExecution();

  const [isWaitingLong] = useDebounceValue(
    node?.data.execution_state?.status === "waiting",
    600
  );

  const { propertiesExpanded, setPropertiesExpanded, setSelectedNode } =
    useWorkflowStore(
      ({ propertiesExpanded, setPropertiesExpanded, setSelectedNode }) => ({
        propertiesExpanded,
        setPropertiesExpanded,
        setSelectedNode,
      })
    );

  const shouldOpenExecutionResults =
    node?.data.execution_state && !propertiesExpanded;

  return (
    <>
      <Tooltip
        label={shouldOpenExecutionResults ? "Execution results" : ""}
        placement="top"
        hasArrow
      >
        <Center
          minWidth="24px"
          minHeight="24px"
          maxWidth="24px"
          maxHeight="24px"
          marginRight="-4px"
          marginLeft="-4px"
          role={shouldOpenExecutionResults ? "button" : undefined}
          cursor={node?.data.execution_state ? "pointer" : undefined}
          onClick={() => {
            if (shouldOpenExecutionResults) {
              setSelectedNode(node.id);
              setPropertiesExpanded(true);
            } else {
              setPropertiesExpanded(false);
            }
          }}
        >
          {isWaitingLong &&
            node?.data.execution_state?.status === "waiting" && (
              <Box marginLeft="-4px" marginRight="-4px">
                <PulseLoader size={2} speedMultiplier={0.5} />
              </Box>
            )}
          {((!isWaitingLong &&
            node?.data.execution_state?.status === "waiting") ||
            node?.data.execution_state?.status === "running") && (
            <Spinner size="xs" />
          )}
          {node?.data.execution_state?.status === "error" ||
          (node?.type === "evaluator" &&
            node?.data.execution_state?.status === "success" &&
            (node?.data.execution_state?.outputs?.status === "error" ||
              node?.data.execution_state?.outputs?.passed === false)) ? (
            <Box color="red.500">
              <X size={iconSize} />
            </Box>
          ) : node?.data.execution_state?.status === "success" ? (
            <Box
              color={
                node?.type === "evaluator" &&
                node?.data.execution_state?.outputs?.status === "skipped"
                  ? "yellow.500"
                  : "green.500"
              }
            >
              <Check size={iconSize} />
            </Box>
          ) : null}
        </Center>
      </Tooltip>
      {node?.data.execution_state?.status === "running" ||
      node?.data.execution_state?.status === "waiting" ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            node &&
              stopComponentExecution({
                node_id: node.id,
                trace_id: node.data.execution_state?.trace_id ?? "",
                current_state: node.data.execution_state,
              });
          }}
          {...props}
        >
          <Square size={iconSize} />
        </Button>
      ) : componentOnly ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            node && startComponentExecution({ node });
          }}
        >
          <Play size={iconSize} />
        </Button>
      ) : (
        <Menu placement="top-start" size="xs" autoSelect={false}>
          <MenuButton variant="ghost" size="xs" paddingX={2} {...props}>
            <Play size={iconSize} />
          </MenuButton>
          <NodeToolbar>
            <MenuList>
              <MenuItem
                icon={<Play size={14} />}
                onClick={() => {
                  node && startComponentExecution({ node });
                }}
                fontSize={13}
              >
                Run this component only
              </MenuItem>
              <MenuItem
                icon={<Play size={14} />}
                onClick={() => {
                  node && startWorkflowExecution({ untilNodeId: node.id });
                }}
                fontSize={13}
              >
                Run all until here
              </MenuItem>
            </MenuList>
          </NodeToolbar>
        </Menu>
      )}
    </>
  );
}
