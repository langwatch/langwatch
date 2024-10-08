import { DragHandleIcon } from "@chakra-ui/icons";
import { Box, Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { useReactFlow, type Node, type XYPosition } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDrag, useDragLayer } from "react-dnd";
import { Box as BoxIcon, ChevronsLeft } from "react-feather";
import { NodeComponents } from "./nodes";
import { HoverableBigText } from "../../components/HoverableBigText";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { MODULES } from "../registry";
import { type Component, type ComponentType } from "../types/dsl";
import { ComponentIcon } from "./ColorfulBlockIcons";
import { getEmptyImage } from "react-dnd-html5-backend";
import { nameToId } from "../utils/nodeUtils";

export function NodeSelectionPanelButton({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) {
  return (
    <Button
      display={isOpen ? "none" : "block"}
      background="white"
      borderRadius={4}
      borderColor="gray.350"
      variant="outline"
      onClick={() => {
        setIsOpen(!isOpen);
      }}
    >
      <BoxIcon size={22} />
    </Button>
  );
}

export const NodeSelectionPanel = ({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) => {
  const { propertiesExpanded } = useWorkflowStore((state) => ({
    propertiesExpanded: state.propertiesExpanded,
    getWorkflow: state.getWorkflow,
  }));

  return (
    <Box
      display={isOpen ? "block" : "none"}
      opacity={propertiesExpanded ? 0 : 1}
      visibility={propertiesExpanded ? "hidden" : "visible"}
      position={
        propertiesExpanded ? "absolute" : isOpen ? "relative" : "absolute"
      }
      top={0}
      left={0}
      background="white"
      borderRight="1px solid"
      borderColor="gray.200"
      zIndex={100}
      height="full"
      padding={3}
      fontSize="14px"
      width="300px"
      minWidth="300px"
    >
      <VStack width="full" height="full">
        <VStack width="full" spacing={4} align="start">
          <Text fontWeight="500" padding={1}>
            Components
          </Text>
          {MODULES.signatures.map((signature) => {
            return (
              <NodeDraggable
                key={signature.name}
                component={signature}
                type="signature"
              />
            );
          })}

          <Text fontWeight="500" padding={1}>
            Evaluators
          </Text>
          {MODULES.evaluators.map((evaluator) => {
            return (
              <NodeDraggable
                key={evaluator.cls}
                component={evaluator}
                type="evaluator"
              />
            );
          })}
        </VStack>
        <Spacer />
        <HStack width="full">
          <Spacer />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsOpen(!isOpen);
            }}
          >
            {isOpen ? <ChevronsLeft size={18} /> : <BoxIcon size={18} />}
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
};

const findLowestAvailableName = (nodes: Node[], prefix: string) => {
  const findNode = (id: string) => {
    return nodes.find((node) => node.id === id);
  };

  let i = 1;
  let name;
  let id;
  do {
    if (i === 1) {
      name = prefix;
    } else {
      name = `${prefix} (${i})`;
    }
    id = nameToId(name);
    i++;
  } while (findNode(id));

  return { name, id };
};

export const NodeDraggable = (props: {
  component: Component;
  type: ComponentType;
}) => {
  const { setNodes, nodes } = useWorkflowStore((state) => ({
    setWorkflow: state.setWorkflow,
    setNodes: state.setNodes,
    nodes: state.nodes,
    propertiesExpanded: state.propertiesExpanded,
  }));
  const { newNode } = useMemo(() => {
    const { name: newName, id: newId } = findLowestAvailableName(
      nodes,
      props.component.name ?? "Component"
    );
    const newNode = {
      id: newId,
      type: props.type,
      data: {
        ...props.component,
        name: newName,
      },
    };

    return { newName, newId, newNode };
  }, [props.component, props.type, nodes]);

  const [collected, drag, preview] = useDrag({
    type: "node",
    item: {
      node: newNode,
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
      clientOffset: monitor.getClientOffset(),
    }),
    end: (item, monitor) => {
      const dropResult = monitor.getDropResult();

      if (item && dropResult) {
        // @ts-ignore
        handleSetNodes(item.node, dropResult.x, dropResult.y);
      }
    },
  });
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

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return (
    <>
      <Box
        background="white"
        ref={drag}
        borderRadius={4}
        padding={1}
        cursor="grab"
        width="full"
        overflow="hidden"
        opacity={collected.isDragging ? 0.5 : 1}
      >
        <HStack width="full">
          <ComponentIcon
            type={props.type}
            cls={props.component.cls}
            size="md"
          />
          <HoverableBigText noOfLines={1}>
            {props.component.name}
          </HoverableBigText>
          <Spacer />
          <DragHandleIcon width="14px" height="14px" color="gray.350" />
        </HStack>
      </Box>
    </>
  );
};

export function CustomDragLayer() {
  const { isDragging, item, currentOffset } = useDragLayer((monitor) => ({
    item: monitor.getItem(),
    itemType: monitor.getItemType(),
    currentOffset: monitor.getClientOffset(),
    isDragging: monitor.isDragging(),
  })) as {
    isDragging: boolean;
    item: { node: Node } | undefined;
    currentOffset: XYPosition;
  };

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (item && ref.current) {
      const { width, height } = ref.current.getBoundingClientRect();
      item.node.width = width;
      item.node.height = height;
    }
  }, [isDragging, item]);

  if (!isDragging || !item) {
    return null;
  }

  const ComponentNode = NodeComponents[item.node.type as ComponentType];

  return (
    <div
      style={{
        position: "fixed",
        pointerEvents: "none",
        zIndex: 200,
        left: currentOffset?.x ?? 0,
        top: currentOffset?.y ?? 0,
        transform: "translate(-50%, -50%)",
        opacity: 0.5,
      }}
    >
      <ComponentNode
        ref={ref}
        id={item.node.id}
        type={item.node.type as ComponentType}
        data={item.node.data as any}
        draggable={false}
        width={item.node.width}
        height={item.node.height}
        deletable={false}
        selectable={false}
        selected={false}
        sourcePosition={undefined}
        targetPosition={undefined}
        dragHandle={undefined}
        parentId={undefined}
        zIndex={200}
        dragging={true}
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />
    </div>
  );
}
