import {
  Box,
  Button,
  Center,
  HStack,
  Spacer,
  Spinner,
  Text,
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
import React, { forwardRef, useMemo, type Ref } from "react";
import { useDragLayer } from "react-dnd";
import {
  Check,
  Copy,
  MoreHorizontal,
  Play,
  Square,
  Trash2,
  X,
} from "react-feather";
import { PulseLoader } from "react-spinners";
import { useDebounceValue } from "usehooks-ts";
import { useShallow } from "zustand/react/shallow";
import { Menu } from "../../../components/ui/menu";
import { Tooltip } from "../../../components/ui/tooltip";
import { useComponentExecution } from "../../hooks/useComponentExecution";
import { useWorkflowExecution } from "../../hooks/useWorkflowExecution";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import {
  type Component,
  type ComponentType,
  type Field,
  type LLMConfig,
} from "../../types/dsl";
import { checkIsEvaluator } from "../../utils/nodeUtils";
import { ComponentIcon } from "../ColorfulBlockIcons";
import { LLMModelDisplay } from "../properties/modals/llm-config/LLMModelDisplay";

export function getNodeDisplayName(node: { id: string; data: Component }) {
  return node.data.name ?? node.data.cls ?? node.id;
}

function NodeInputs({
  node,
  namespace,
  inputs,
  selected,
}: {
  node?: Node<Component>;
  namespace: string;
  inputs: Field[];
  selected: boolean;
}) {
  return (
    <>
      {inputs.map((input) => (
        <HStack
          key={input.identifier}
          gap={1}
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
          <Spacer />
          {input.optional &&
            (!node ||
              node.type !== "end" ||
              (input.identifier !== "score" &&
                input.identifier !== "passed")) && (
              <Text color="gray.400">(optional)</Text>
            )}
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
          gap={1}
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
  fontSize?: string;
  children: React.ReactNode;
}) {
  return (
    <Text
      fontSize={fontSize ?? "9px"}
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

export const ComponentNode = forwardRef(function ComponentNode(
  props: NodeProps<Node<Component>> & {
    icon?: React.ReactNode;
    children?: React.ReactNode;
    fieldsAfter?: React.ReactNode;
    inputsTitle?: string;
    outputsTitle?: string;
    hidePlayButton?: boolean;
    hideOutputHandles?: boolean;
    backgroundColor?: string;
    behave_as?: "evaluator" | undefined;
  },
  ref: Ref<HTMLDivElement>
) {
  const {
    node,
    hoveredNodeId,
    setHoveredNodeId,
    setSelectedNode,
    setPropertiesExpanded,
    deleteNode,
    duplicateNode,
  } = useWorkflowStore(
    useShallow(
      ({
        nodes,
        hoveredNodeId,
        setHoveredNodeId,
        setSelectedNode,
        setPropertiesExpanded,
        setNodes,
        deleteNode,
        duplicateNode,
      }) => ({
        node: nodes.find((node) => node.id === props.id),
        hoveredNodeId,
        setHoveredNodeId,
        setSelectedNode,
        setPropertiesExpanded,
        setNodes,
        deleteNode,
        duplicateNode,
      })
    )
  );
  const isHovered = hoveredNodeId === props.id;

  const { isDragging, item } = useDragLayer((monitor) => ({
    item: monitor.getItem(),
    itemType: monitor.getItemType(),
    isDragging: monitor.isDragging(),
  })) as {
    isDragging: boolean;
    item: { node?: Node } | undefined;
  };

  const isNotDroppable = useMemo(
    () =>
      isDragging &&
      item?.node?.type === "prompting_technique" &&
      props.type !== "signature",
    [isDragging, item, props.type]
  );

  const llmParams =
    props.data.parameters?.filter((p) => p.type === "llm") ?? [];

  return (
    <VStack
      className="js-component-node"
      position="relative"
      opacity={isNotDroppable ? 0.4 : 1}
      ref={ref}
      borderRadius="12px"
      backgroundColor={props.backgroundColor ?? "white"}
      padding="10px"
      gap={2}
      align="start"
      color="gray.600"
      fontSize="11px"
      minWidth="180px"
      boxShadow={`0px 0px 4px 0px rgba(0, 0, 0, ${isHovered ? "0.2" : "0.1"})`}
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
      {props.selected && !["entry", "end"].includes(props.type) && (
        <Menu.Root positioning={{ placement: "top-start" }}>
          <Menu.Trigger asChild>
            <Button
              background="white"
              position="absolute"
              top="-28px"
              right={1}
              paddingX={1}
              paddingY={1}
              borderRadius={6}
              minWidth="auto"
              minHeight="auto"
              boxShadow="sm"
              width="auto"
              height="auto"
            >
              <MoreHorizontal size={11} />
            </Button>
          </Menu.Trigger>
          <NodeToolbar>
            <Menu.Content>
              <Menu.Item
                value="duplicate"
                onClick={() => duplicateNode(props.id)}
              >
                <Copy size={14} />
                Duplicate
              </Menu.Item>
              <Menu.Item value="delete" onClick={() => deleteNode(props.id)}>
                <Trash2 size={14} />
                Delete
              </Menu.Item>
            </Menu.Content>
          </NodeToolbar>
        </Menu.Root>
      )}
      <HStack gap={2} width="full">
        <ComponentIcon
          type={props.type as ComponentType}
          cls={props.data.cls}
          behave_as={props.data.behave_as}
          size="md"
        />
        <Text fontSize="12px" fontWeight={500}>
          {getNodeDisplayName(props)}
        </Text>
        <Spacer />
        {node && isExecutableComponent(node) ? (
          <ComponentExecutionButton
            node={node}
            marginRight="-6px"
            marginLeft="-4px"
            isInsideNode={true}
          />
        ) : (
          <Box width="54px" />
        )}
      </HStack>

      {props.children}
      {llmParams
        .filter((llmParam) => llmParam.value)
        .map((llmParam) => (
          <React.Fragment key={llmParam.identifier}>
            <NodeSectionTitle>LLM</NodeSectionTitle>
            <HStack width="full">
              <LLMModelDisplay
                model={(llmParam?.value as LLMConfig).model}
                fontSize="11px"
              />
            </HStack>
          </React.Fragment>
        ))}
      {props.data.inputs && (
        <>
          <NodeSectionTitle>{props.inputsTitle ?? "Inputs"}</NodeSectionTitle>
          <NodeInputs
            node={node}
            namespace="inputs"
            inputs={props.data.inputs}
            selected={!!props.selected || isHovered}
          />
        </>
      )}
      {props.data.outputs && (
        <>
          <NodeSectionTitle>{props.outputsTitle ?? "Outputs"}</NodeSectionTitle>
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
});

export function ComponentExecutionButton({
  node,
  iconSize = 14,
  componentOnly = false,
  isInsideNode = false,
  ...props
}: {
  node: Node<Component>;
  iconSize?: number;
  componentOnly?: boolean;
  isInsideNode?: boolean;
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

  const Wrapper = isInsideNode ? NodeToolbar : Box;

  return (
    <>
      <Tooltip
        content={shouldOpenExecutionResults ? "Execution results" : ""}
        positioning={{ placement: "top" }}
        showArrow
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
          (checkIsEvaluator(node) &&
            node?.data.execution_state?.status === "success" &&
            (node?.data.execution_state?.outputs?.status === "error" ||
              node?.data.execution_state?.outputs?.passed === false)) ? (
            <Box color="red.500">
              <X size={iconSize} />
            </Box>
          ) : node?.data.execution_state?.status === "success" ? (
            <Box
              color={
                checkIsEvaluator(node) &&
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
        <Menu.Root positioning={{ placement: "top-start" }}>
          <Menu.Trigger asChild>
            <Button variant="ghost" size="xs" paddingX={2} {...props}>
              <Play size={iconSize} />
            </Button>
          </Menu.Trigger>
          <Wrapper>
            <Menu.Content>
              <Menu.Item
                value="run-manual"
                onClick={() => node && startComponentExecution({ node })}
              >
                <Play size={14} />
                Run with manual input
              </Menu.Item>
              <Menu.Item
                value="run-workflow"
                onClick={() =>
                  node && startWorkflowExecution({ untilNodeId: node.id })
                }
              >
                <Play size={14} />
                Run workflow until here
              </Menu.Item>
            </Menu.Content>
          </Wrapper>
        </Menu.Root>
      )}
    </>
  );
}
