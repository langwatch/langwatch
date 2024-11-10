import { DragHandleIcon } from "@chakra-ui/icons";
import {
  Box,
  Button,
  HStack,
  position,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useReactFlow, type Node, type XYPosition } from "@xyflow/react";
import { useEffect, useMemo, useRef } from "react";
import { useDrag, useDragDropManager, useDragLayer } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { Box as BoxIcon, ChevronsLeft } from "react-feather";
import { HoverableBigText } from "../../components/HoverableBigText";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { MODULES } from "../registry";
import { type Component, type ComponentType } from "../types/dsl";
import { findLowestAvailableName } from "../utils/nodeUtils";
import { ComponentIcon } from "./ColorfulBlockIcons";
import { NodeComponents } from "./nodes";
import { PromptingTechniqueDraggingNode } from "./nodes/PromptingTechniqueNode";

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
      height="calc(100vh - 49px)"
      fontSize="14px"
      width="300px"
      minWidth="300px"
    >
      <VStack width="full" height="full" spacing={0}>
        <VStack
          width="full"
          height="full"
          spacing={4}
          align="start"
          overflowY="auto"
          padding={3}
          paddingBottom="56px"
        >
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

          {/* <Text fontWeight="500" padding={1}>
            Prompting Techniques
          </Text>
          {MODULES.promptingTechniques.map((promptingTechnique) => {
            return (
              <NodeDraggable
                key={promptingTechnique.name}
                component={promptingTechnique}
                type="prompting_technique"
              />
            );
          })} */}

          <Text fontWeight="500" padding={1}>
            Retrievers
          </Text>
          {MODULES.retrievers.map((retriever) => {
            return (
              <NodeDraggable
                key={retriever.name}
                component={retriever}
                type="retriever"
              />
            );
          })}

          <Text fontWeight="500" padding={1}>
            Evaluators
          </Text>
          {MODULES.evaluators.map((evaluator) => {
            return (
              <NodeDraggable
                key={evaluator.name}
                component={evaluator}
                type="evaluator"
              />
            );
          })}
        </VStack>
        <HStack width="full" padding={3} position="absolute" bottom={0}>
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

export const NodeDraggable = (props: {
  component: Component;
  type: ComponentType;
}) => {
  const { setNodes, setNode, nodes } = useWorkflowStore((state) => ({
    setWorkflow: state.setWorkflow,
    setNodes: state.setNodes,
    setNode: state.setNode,
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
      setNode({
        id,
        data: {
          decorated_by: [
            ...(currentNode?.data.decorated_by ?? []),
            {
              ref: newNode.id,
            },
          ],
        },
      });
    }
  };

  const [collected, drag, preview] = useDrag({
    type:
      newNode.type === "prompting_technique" ? "prompting_technique" : "node",
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
        if (item.node.type === "prompting_technique") {
          // @ts-ignore
          handleSetPromptingTechnique(item.node, dropResult.id);
        } else {
          // @ts-ignore
          handleSetNodes(item.node, dropResult.x, dropResult.y);
        }
      }
    },
  });

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

  const ComponentNode =
    item.node.type === "prompting_technique"
      ? PromptingTechniqueDraggingNode
      : NodeComponents[item.node.type as ComponentType];

  return (
    <div
      style={{
        position: "fixed",
        pointerEvents: "none",
        zIndex: 200,
        left: currentOffset?.x ?? 0,
        top: currentOffset?.y ?? 0,
        transform: "translate(-50%, -50%)",
        opacity: item.node.type === "prompting_technique" ? 1 : 0.5,
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
