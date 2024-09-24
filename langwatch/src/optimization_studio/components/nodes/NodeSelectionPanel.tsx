import { DragHandleIcon } from "@chakra-ui/icons";
import { Box, Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import {
  useViewport,
  type XYPosition,
  type Node as XYFlowNode,
  useReactFlow,
} from "@xyflow/react";
import { useState } from "react";
import { Box as BoxIcon, X, ChevronsLeft } from "react-feather";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import { type ComponentType } from "../../types/dsl";
import { ComponentIcon } from "../ColorfulBlockIcons";
import { useDrag } from "react-dnd";

export const NodeSelectionPanel = () => {
  const { propertiesExpanded } = useWorkflowStore((state) => ({
    propertiesExpanded: state.propertiesExpanded,
  }));

  const [isOpen, setIsOpen] = useState(true);
  return (
    <>
      <Box
        display={isOpen ? "none" : "block"}
        position="absolute"
        top={2}
        left={2}
        zIndex={100}
        background="white"
        borderRadius={4}
        borderColor="gray.350"
      >
        <Button
          variant="outline"
          onClick={() => {
            setIsOpen(!isOpen);
          }}
        >
          <BoxIcon size={22} />
        </Button>
      </Box>
      <Box
        display={isOpen ? "block" : "none"}
        opacity={propertiesExpanded ? 0 : 1}
        visibility={propertiesExpanded ? "hidden" : "visible"}
        // transform={propertiesExpanded ? "translateX(-100%)" : "translateX(0)"}
        // transition="opacity 0.3s, visibility 0.3s, transform 0.3s"
        position={
          propertiesExpanded ? "absolute" : isOpen ? "relative" : "absolute"
        }
        top={0}
        left={0}
        background="white"
        border="1px solid"
        borderColor="gray.350"
        borderTopWidth={0}
        borderBottomWidth={0}
        borderRightWidth={0}
        zIndex={100}
        height="full"
        padding={2}
      >
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
        <VStack spacing={4} align="start">
          <Text fontWeight="500" padding={1}>
            Components
          </Text>
          {signatures.map((signature) => {
            return <NodeDraggable key={signature.id} node={signature} />;
          })}
          <Text fontWeight="500" padding={1}>
            Evaluators
          </Text>
          {evaluators.map((evaluator) => {
            return <NodeDraggable key={evaluator.id} node={evaluator} />;
          })}
        </VStack>
      </Box>
    </>
  );
};

type Node = {
  id: string;
  type: string;
  position?: XYPosition;
  data: {
    name: string;
    inputs: { identifier: string; type: string }[];
    outputs: { identifier: string; type: string }[];
  };
};

export const NodeDraggable = (props: { node: Node }) => {
  const [{ isDragging }, drag] = useDrag({
    type: "node",
    item: { node: props.node },
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
  const { setNodes, nodes } = useWorkflowStore((state) => ({
    setWorkflow: state.setWorkflow,
    setNodes: state.setNodes,
    nodes: state.nodes,
    propertiesExpanded: state.propertiesExpanded,
  }));

  const extractIdNumber = (str?: string) => {
    const match = str?.match(/_(\d+)$/);
    return match?.[1] ? parseInt(match[1], 10) : null;
  };

  const findLowestAvailableId = (prefix: string) => {
    const usedIds = nodes
      .map((node) => extractIdNumber(node.id))
      .filter((id) => id !== null);

    let i = 1;
    while (usedIds.includes(i)) {
      i++;
    }
    return `${prefix}_${i}`;
  };

  const handleSetNodes = (e: Node, x: number, y: number) => {
    const newNode = props.node;

    const new_id = findLowestAvailableId(newNode.type);
    newNode.id = new_id;

    const position = screenToFlowPosition({ x: x, y: y });

    console.log("new_node", newNode);
    console.log("nodes", nodes);

    if (newNode) {
      newNode.position = {
        x: position.x,
        y: position.y,
      } as XYPosition;
      setNodes([...nodes, newNode as XYFlowNode]);
    }
  };

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
        opacity={isDragging ? 0.5 : 1}
      >
        <HStack>
          <ComponentIcon type={props.node.type as ComponentType} size="md" />
          <Text>{props.node.data.name}</Text>
          <Spacer />
          <DragHandleIcon width="14px" height="14px" color="gray.350" />
        </HStack>
      </Box>
    </>
  );
};

const signatures = [
  {
    id: "signature_1",
    type: "signature",

    data: {
      name: "LLM Signature",
      inputs: [
        {
          identifier: "question",
          type: "str",
        },
      ],
      outputs: [
        {
          identifier: "query",
          type: "str",
        },
      ],
    },
  },
];

const evaluators = [
  {
    id: "evaluator_1",
    type: "evaluator",

    data: {
      cls: "ExactMatchEvaluator",
      name: "ExactMatchEvaluator",
      inputs: [
        { identifier: "output", type: "str" },
        { identifier: "expected_output", type: "str" },
      ],
      outputs: [
        { identifier: "passed", type: "bool" },
        { identifier: "score", type: "float" },
      ],
    },
  },
];
