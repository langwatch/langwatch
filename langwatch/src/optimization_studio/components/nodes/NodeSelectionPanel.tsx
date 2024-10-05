import { DragHandleIcon } from "@chakra-ui/icons";
import { Box, Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import {
  useReactFlow,
  type Node as XYFlowNode,
  type XYPosition,
} from "@xyflow/react";
import { useDrag } from "react-dnd";
import { Box as BoxIcon, ChevronsLeft } from "react-feather";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import { type ComponentType } from "../../types/dsl";
import { ComponentIcon } from "../ColorfulBlockIcons";

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
    >
      <VStack height="full">
        <VStack spacing={4} align="start">
          <Text fontWeight="500" padding={1}>
            Components
          </Text>
          {signatures.map((signature) => {
            const nodeCopy = JSON.parse(JSON.stringify(signature));
            return <NodeDraggable key={signature.id} node={nodeCopy} />;
          })}

          <Text fontWeight="500" padding={1}>
            Evaluators
          </Text>
          {evaluators.map((evaluator) => {
            const nodeCopy = JSON.parse(JSON.stringify(evaluator));
            return <NodeDraggable key={evaluator.id} node={nodeCopy} />;
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
    const match = str?.match(/\((\d+)\)$/);
    return match?.[1] ? parseInt(match[1], 10) : null;
  };

  const findLowestAvailableId = (prefix: string, type: string) => {
    const usedIds = nodes
      .filter((node) => node.type === type)
      .map((node) => extractIdNumber(node.id))
      .filter((id): id is number => id !== null);

    let i = 1;
    while (usedIds.includes(i)) {
      i++;
    }

    return `${prefix}(${i})`;
  };

  const handleSetNodes = (e: Node, x: number, y: number) => {
    const newNode = props.node;

    if (nodes.length > 0) {
      const new_id = findLowestAvailableId(newNode.data.name, newNode.type);
      newNode.id = new_id.toLowerCase().replace(/\s/g, "_");
      newNode.data.name = new_id;
    }

    const position = screenToFlowPosition({ x: x, y: y });

    if (newNode) {
      newNode.position = {
        x: position.x - 90,
        y: position.y - 80,
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
    id: "llm_signature",
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
