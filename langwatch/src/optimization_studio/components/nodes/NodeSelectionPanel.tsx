import { Box, Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { ComponentIcon } from "../ColorfulBlockIcons";
import {
  type Component,
  type ComponentType,
  type Field,
} from "../../types/dsl";
import { CloseIcon, DragHandleIcon } from "@chakra-ui/icons";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import { nanoid } from "nanoid";
import { LLMSignatureFlow } from "../../../optimization_studio/types/dsl";
import { useViewport } from "@xyflow/react";
import { ArrowLeft, ChevronLeft, X, Box as BoxIcon } from "react-feather";
import { useState } from "react";

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
        top={0}
        left={0}
        zIndex={100}
        background="white"
        borderRadius={4}
        borderTopLeftRadius={0}
        borderTopRightRadius={0}
        borderTop={"none"}
        borderLeft={"none"}
        borderColor="gray.350"
      >
        <Button
          variant="outline"
          borderTop="none"
          borderTopLeftRadius={0}
          borderTopRightRadius={0}
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
        transform={propertiesExpanded ? "translateX(-100%)" : "translateX(0)"}
        transition="opacity 0.3s, visibility 0.3s, transform 0.3s"
        position="absolute"
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
            {isOpen ? <X size={18} /> : <BoxIcon size={18} />}
          </Button>
        </HStack>
        <VStack spacing={4} align="start">
          <Text fontWeight="500" padding={1}>
            Components
          </Text>
          {evaluators.map((evaluator) => {
            return (
              <NodeDraggable
                name={evaluator.data.name}
                key={evaluator.id}
                type={evaluator.type as ComponentType}
              />
            );
          })}
        </VStack>
      </Box>
    </>
  );
};

export const NodeDraggable = (props: { type: ComponentType; name: string }) => {
  const { x, y, zoom } = useViewport();
  const { setWorkflow, setNodes, nodes, propertiesExpanded } = useWorkflowStore(
    (state) => ({
      setWorkflow: state.setWorkflow,
      setNodes: state.setNodes,
      nodes: state.nodes,
      propertiesExpanded: state.propertiesExpanded,
    })
  );

  function incrementLastChar(str: string) {
    const lastChar = str.slice(-1);

    if (!isNaN(lastChar as any)) {
      const incrementedChar = parseInt(lastChar) + 1;

      return str.slice(0, -1) + incrementedChar;
    } else {
      return str;
    }
  }

  const handleSetNodes = (e: React.DragEvent<HTMLDivElement>, name: string) => {
    console.log(x, y, zoom);
    console.log(nodes);
    const new_node = evaluators.filter((node) => node.data.name === name);

    const existing_node = nodes.filter((node) => node.id === new_node[0]?.id);

    if (existing_node.length > 0 && new_node[0]) {
      const new_id = incrementLastChar(new_node[0].id);
      new_node[0].id = new_id;
    }

    if (new_node[0]) {
      new_node[0].position = {
        x: e.clientX - x,
        y: e.clientY - y,
      };
      setNodes([...nodes, new_node[0]]);
    }
    console.log(new_node);
  };

  return (
    <Box
      background="white"
      draggable
      borderRadius={4}
      padding={1}
      cursor="grab"
      width="220px"
      overflow="hidden"
      onDragEnd={(e) => {
        handleSetNodes(e, props.name);
      }}
    >
      <HStack>
        <ComponentIcon type={props.type} size="md" />
        <Text>{props.name}</Text>
        <Spacer />
        <DragHandleIcon width="14px" height="14px" color="gray.350" />
      </HStack>
    </Box>
  );
};

const evaluators = [
  {
    id: "generate_query_1",
    type: "signature",
    position: {
      x: 0,
      y: 0,
    },
    data: {
      name: "GenerateQuery",
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
  {
    id: "generate_answer_1",
    type: "signature",
    data: {
      name: "GenerateAnswer",
      inputs: [
        {
          identifier: "question",
          type: "str",
        },
        {
          identifier: "contexts",
          type: "list[str]",
        },
      ],
      outputs: [
        {
          identifier: "answer",
          type: "str",
        },
      ],
    },
  },
  {
    id: "exact_match_evaluator_1",
    type: "evaluator",
    data: {
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
