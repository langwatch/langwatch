import { Box, HStack, Spacer } from "@chakra-ui/react";
import { type Node, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect } from "react";
import { useDrag } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { LuGripVertical } from "react-icons/lu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { updateCodeClassName } from "./workflow-store";
import { useWorkflowStore } from "./hooks/use-workflow-store";
import type { Component, ComponentType } from "@langwatch/workflow-contract";
import {
  findLowestAvailableName,
  nameToId,
  type NodeWithOptionalPosition,
} from "@langwatch/workflow-contract";
import { useWorkflowNodeHost } from "./workflow-node.host";

type NodeDragItem = { node: Node<Component> };
type CanvasDropResult = { x: number; y: number };

/**
 * This is the component that is used to drag and drop a node from the node selection panel
 * to the canvas.
 */
export const NodeDraggable = (props: {
  component: Component;
  type: ComponentType;
  behave_as?: "evaluator";
  disableDrag?: boolean;
  onDragEnd?: (item: { node: NodeWithOptionalPosition<Component> }) => void;
}) => {
  const { ComponentIcon, HoverableBigText } = useWorkflowNodeHost();
  const { setNodes, nodes } = useWorkflowStore((state) => ({
    setNodes: state.setNodes,
    nodes: state.nodes,
  }));

  const createNewNode = useCallback(() => {
    const { name: newName, id: newId } = findLowestAvailableName(
      nodes.map((node) => node.id),
      props.component.name ?? "Component",
    );
    const newNode: Node<Component> = {
      id: newId,
      type: props.type,
      position: { x: 0, y: 0 },
      data: {
        ...props.component,
        name: newName,
        ...(props.behave_as ? { behave_as: props.behave_as } : {}),
        ...(props.type === "code"
          ? {
              parameters: updateCodeClassName(
                props.component.parameters ?? [],
                nameToId(props.component.name ?? ""),
                newId,
              ),
            }
          : {}),
      },
    };

    return newNode;
  }, [nodes, props.component, props.type, props.behave_as]);

  const { screenToFlowPosition } = useReactFlow();

  const handleSetNodes = (newNode: Node<Component>, x: number, y: number) => {
    const position = screenToFlowPosition({ x: x, y: y });

    if (newNode) {
      newNode.position = {
        x: position.x - (newNode.width ?? 0) / 2,
        y: position.y - (newNode.height ?? 0) / 2,
      };
      setNodes([...nodes, newNode]);
    }
  };

  const [collected, drag, preview] = useDrag<
    NodeDragItem,
    CanvasDropResult,
    { isDragging: boolean; clientOffset: { x: number; y: number } | null }
  >({
    type: "node",
    item: () => {
      return { node: createNewNode() };
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
      clientOffset: monitor.getClientOffset(),
    }),
    end: (item, monitor) => {
      const dropResult = monitor.getDropResult();

      if (item && dropResult) {
        handleSetNodes(item.node, dropResult.x, dropResult.y);
      }

      // Only fire onDragEnd when the node was actually placed on canvas
      if (item && dropResult) {
        props.onDragEnd?.(item);
      }
    },
  });

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return (
    <>
      <Tooltip
        showArrow
        positioning={{ gutter: 16, placement: "right" }}
        content={
          props.disableDrag
            ? "You cannot add the same component as your workflow"
            : (props.component.description ?? "")
        }
      >
        <Box
          background="bg"
          ref={props.disableDrag ? void 0 : drag}
          borderRadius={4}
          padding={1}
          cursor={props.disableDrag ? "not-allowed" : "grab"}
          width="full"
          opacity={collected.isDragging ? 0.5 : 1}
        >
          <HStack width="full">
            <ComponentIcon
              type={props.type}
              cls={props.component.cls}
              behave_as={props.behave_as}
              size="md"
            />
            <HoverableBigText lineClamp={1} expandable={false}>
              {props.component.name}
            </HoverableBigText>
            <Spacer />
            <Box color="fg.subtle">
              <LuGripVertical size={18} />
            </Box>
          </HStack>
        </Box>
      </Tooltip>
    </>
  );
};
