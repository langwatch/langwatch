import { Box, Button, Circle, HStack, Spacer, Text, VStack } from "@chakra-ui/react";

import {
  Handle,
  type Node,
  type NodeProps,
  NodeToolbar,
  Position,
  useUpdateNodeInternals,
} from "@xyflow/react";
import React, { forwardRef, type Ref, useEffect, useMemo } from "react";
import { useDragLayer } from "react-dnd";
import { Copy, MoreHorizontal, Trash2 } from "react-feather";
import { useShallow } from "zustand/react/shallow";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useWorkflowStore } from "./hooks/use-workflow-store";
import type {
  Component,
  ComponentType,
  Field,
  LLMConfig,
} from "@langwatch/workflow-contract";
import { GATE_FIELD, showsTemporaryGate } from "./utils/control-flow";
import { hasUnsavedChanges } from "./utils/unsaved-changes";
import { useWorkflowNodeHost } from "./workflow-node.host";
import { ComponentExecutionButton } from "./workflow-node-execution";

export function getNodeDisplayName(node: {
  id: string;
  data: { localConfig?: { name?: string }; name?: string; cls?: string };
}) {
  return node.data.localConfig?.name ?? node.data.name ?? node.data.cls ?? node.id;
}

function NodeInputs({
  namespace,
  inputs,
  selected,
  showGateDropTarget,
}: {
  namespace: string;
  inputs: Field[];
  selected: boolean;
  /** Show the temporary green "gate" drop row while a branch is dragged. */
  showGateDropTarget?: boolean;
}) {
  return (
    <>
      {inputs.map((input) => (
        <HStack
          key={input.identifier}
          gap={1}
          paddingX={2}
          paddingY={1}
          background="bg.muted"
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
              background: "var(--chakra-colors-bg)",
              borderRadius: "100%",
              border: `1px solid #FF8309`,
              boxShadow: `0px 0px ${selected ? "4px" : "2px"} 0px #FF8309`,
            }}
          />
          <Text>{input.identifier}</Text>
          <Text color="fg.subtle">:</Text>
          <TypeLabel type={input.type} />
          <Spacer />
          {input.optional && <Text color="fg.subtle">(optional)</Text>}
        </HStack>
      ))}
      {showGateDropTarget && (
        <HStack
          key="__branch_gate__"
          gap={1}
          paddingX={2}
          paddingY={1}
          background="green.50"
          borderRadius="8px"
          width="full"
          position="relative"
          data-testid="branch-gate-drop-target"
        >
          <Handle
            type="target"
            id={`${namespace}.${GATE_FIELD}`}
            position={Position.Left}
            style={{
              marginLeft: "-10px",
              width: "9px",
              height: "9px",
              background: "var(--chakra-colors-bg)",
              borderRadius: "100%",
              border: "1px solid #22C55E",
              boxShadow: "0px 0px 4px 0px #22C55E",
            }}
          />
          <Text color="green.fg">{GATE_FIELD}</Text>
          <Text color="green.fg">:</Text>
          <TypeLabel type="bool" />
        </HStack>
      )}
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
          background="bg.muted"
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
                background: "var(--chakra-colors-bg)",
                borderRadius: "100%",
                border: `1px solid #2B6CB0`,
                boxShadow: `0px 0px ${selected ? "4px" : "2px"} 0px #2B6CB0`,
              }}
            />
          )}
          <Text>{output.identifier}</Text>
          <Text color="fg.subtle">:</Text>
          <TypeLabel type={output.type} />
        </HStack>
      ))}
    </>
  );
}

export function TypeLabel({ type }: { type: string }) {
  return (
    <Text color="cyan.fg" fontStyle="italic">
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
      color="fg.muted"
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
    behave_as?: "evaluator";
  },
  ref: Ref<HTMLDivElement>,
) {
  const { ComponentIcon, LLMModelDisplay, useColorModeValue } = useWorkflowNodeHost();
  const {
    node,
    hoveredNodeId,
    setHoveredNodeId,
    setSelectedNode,
    setPropertiesExpanded,
    deleteNode,
    duplicateNode,
    branchConnectionInProgress,
    branchConnectionSourceId,
  } = useWorkflowStore(
    useShallow(
      ({
        nodes,
        hoveredNodeId,
        setHoveredNodeId,
        setSelectedNode,
        setPropertiesExpanded,
        deleteNode,
        duplicateNode,
        branchConnectionInProgress,
        branchConnectionSourceId,
      }) => ({
        node: nodes.find((node) => node.id === props.id),
        hoveredNodeId,
        setHoveredNodeId,
        setSelectedNode,
        setPropertiesExpanded,
        deleteNode,
        duplicateNode,
        branchConnectionInProgress,
        branchConnectionSourceId,
      }),
    ),
  );
  const isHovered = hoveredNodeId === props.id;

  // While an If/Else branch is dragged, every connectable node without a gate
  // input grows a temporary green "gate" drop row. Re-register handles with
  // React Flow whenever that row appears/disappears so the drop target is live.
  const showGateDropTarget =
    branchConnectionInProgress &&
    showsTemporaryGate({
      node: { id: props.id, type: props.type, data: props.data },
      sourceId: branchConnectionSourceId,
    });
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(props.id);
  }, [props.id, showGateDropTarget, updateNodeInternals]);

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
    [isDragging, item, props.type],
  );

  const llmParams = props.data.parameters?.filter((p) => p.type === "llm") ?? [];

  const nodeShadow = useColorModeValue(
    `0px 0px 4px 0px rgba(0, 0, 0, ${isHovered ? "0.2" : "0.1"})`,
    `0px 0px 4px 0px rgba(0, 0, 0, ${isHovered ? "0.5" : "0.3"})`,
  );

  return (
    <VStack
      className="js-component-node"
      position="relative"
      opacity={isNotDroppable ? 0.4 : 1}
      ref={ref}
      borderRadius="12px"
      backgroundColor={props.backgroundColor ?? "bg.panel"}
      padding="10px"
      gap={2}
      align="start"
      color="fg.muted"
      fontSize="11px"
      minWidth={140 + 6.5 * Math.min(getNodeDisplayName(props).length, 24) + "px"}
      boxShadow={nodeShadow}
      border="1px solid"
      borderColor="border"
      outline={!!props.selected || isHovered ? "1.5px solid" : "none"}
      outlineColor={
        props.selected ? selectionColor : isHovered ? "gray.emphasized" : "none"
      }
      onMouseEnter={() => setHoveredNodeId(props.id)}
      onMouseLeave={() => setHoveredNodeId(void 0)}
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
              background="bg"
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
              <Menu.Item value="duplicate" onClick={() => duplicateNode(props.id)}>
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
        <Text
          fontSize="12px"
          fontWeight={500}
          minWidth="0"
          flexShrink={1}
          lineClamp={1}
          wordBreak="break-all"
          width="full"
        >
          {getNodeDisplayName(props)}
        </Text>
        {hasUnsavedChanges(props.data) && (
          <Tooltip
            content="Unsaved changes"
            positioning={{ placement: "top" }}
            openDelay={0}
            showArrow
          >
            <Circle
              size="8px"
              bg="orange.solid"
              flexShrink={0}
              data-testid="unsaved-changes-indicator"
            />
          </Tooltip>
        )}
        {node && isExecutableComponent(node) ? (
          <ComponentExecutionButton node={node} marginRight="-6px" marginLeft="-4px" />
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
                model={(llmParam.value as LLMConfig).model}
                fontSize="11px"
              />
            </HStack>
          </React.Fragment>
        ))}
      {(props.data.inputs || showGateDropTarget) && (
        <>
          <NodeSectionTitle>{props.inputsTitle ?? "Inputs"}</NodeSectionTitle>
          <NodeInputs
            namespace="inputs"
            inputs={props.data.inputs ?? []}
            selected={!!props.selected || isHovered}
            showGateDropTarget={showGateDropTarget}
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
