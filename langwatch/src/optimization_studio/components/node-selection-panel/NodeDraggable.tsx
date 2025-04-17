import { Box, HStack, Spacer } from "@chakra-ui/react";
import { useDrag } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { useReactFlow, type Node, type XYPosition } from "@xyflow/react";
import { useCallback, useEffect, useMemo } from "react";
import { LuGripVertical } from "react-icons/lu";
import { Tooltip } from "../../../components/ui/tooltip";
import {
  updateCodeClassName,
  useWorkflowStore,
} from "../../hooks/useWorkflowStore";
import { ComponentIcon } from "../ColorfulBlockIcons";
import { HoverableBigText } from "../../../components/HoverableBigText";
import { findLowestAvailableName, nameToId } from "../../utils/nodeUtils";
import type { Component, ComponentType } from "../../types/dsl";
import type { NodeWithOptionalPosition } from "~/types";

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
  const { setNodes, setNodeParameter, deleteNode, nodes } = useWorkflowStore(
    (state) => ({
      setWorkflow: state.setWorkflow,
      setNodes: state.setNodes,
      setNodeParameter: state.setNodeParameter,
      deleteNode: state.deleteNode,
      nodes: state.nodes,
      propertiesExpanded: state.propertiesExpanded,
    })
  );

  const createNewNode = useCallback(() => {
    const { name: newName, id: newId } = findLowestAvailableName(
      nodes.map((node) => node.id),
      props.component.name ?? "Component"
    );
    const newNode = {
      id: newId,
      type: props.type,
      data: {
        ...props.component,
        name: newName,
        behave_as: props.behave_as,
        ...(props.type === "code"
          ? {
              parameters: updateCodeClassName(
                props.component.parameters ?? [],
                nameToId(props.component.name ?? ""),
                newId
              ),
            }
          : {}),
      },
    };

    return newNode;
  }, [nodes, props.component, props.type, props.behave_as]);

  const { screenToFlowPosition } = useReactFlow();

  const handleSetNodes = (newNode: Node, x: number, y: number) => {
    const position = screenToFlowPosition({ x: x, y: y });

    if (newNode) {
      newNode.position = {
        x: position.x - (newNode.width ?? 0) / 2,
        y: position.y - (newNode.height ?? 0) / 2,
      };
      setNodes([...nodes, newNode]);
    }
  };

  const handleSetPromptingTechnique = (newNode: Node, id: string) => {
    if (newNode) {
      newNode.position = {
        x: 0,
        y: 0,
      };
      setNodes([...nodes, newNode]);

      const currentNode = nodes.find((node) => node.id === id);
      for (const parameter of currentNode?.data.parameters ?? []) {
        if (parameter.type === "prompting_technique") {
          if (parameter.value) {
            deleteNode((parameter.value as { ref: string }).ref);
          }
          setNodeParameter(id, {
            identifier: parameter.identifier,
            type: "prompting_technique",
            value: {
              ref: newNode.id,
            },
          });
        }
      }
    }
  };

  const [collected, drag, preview] = useDrag({
    type: props.type === "prompting_technique" ? "prompting_technique" : "node",
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
        if (item.node.type === "prompting_technique") {
          // @ts-ignore
          handleSetPromptingTechnique(item.node, dropResult.id);
        } else {
          // @ts-ignore
          handleSetNodes(item.node, dropResult.x, dropResult.y);
        }
      }

      // It's important to do this at the end so it has the update state
      props.onDragEnd?.(item);
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
            : props.component.description ?? ""
        }
      >
        <Box
          background="white"
          ref={props.disableDrag ? undefined : drag}
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
            <Box color="gray.350">
              <LuGripVertical size={18} />
            </Box>
          </HStack>
        </Box>
      </Tooltip>
    </>
  );
};
