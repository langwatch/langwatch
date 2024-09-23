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
import { ArrowLeft, ChevronLeft, X } from "react-feather";
import { useState } from "react";

export const NodeSelectionPanel = () => {
  const { propertiesExpanded } = useWorkflowStore((state) => ({
    propertiesExpanded: state.propertiesExpanded,
  }));

  const [isOpen, setIsOpen] = useState(true);
  return (
    <Box
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
      padding={4}
    >
      <VStack spacing={5} align="start">
        <HStack width="full">
          <Text fontWeight="500">Components</Text>
          <Spacer />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsOpen(!isOpen);
            }}
          >
            <X size={16} />
            {/* <ChevronLeft size={18} /> */}
          </Button>
        </HStack>

        {LLMSignatureFlow.nodes.map((node) => (
          <NodeDraggable
            name={node.data.name}
            key={node.id}
            type={node.type as ComponentType}
          />
        ))}
      </VStack>
    </Box>
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

  const handleSetNodes = (e: React.DragEvent<HTMLDivElement>, name: string) => {
    console.log(x, y, zoom);
    const new_node = LLMSignatureFlow.nodes.filter(
      (node) => node.data.name === name
    );

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
      cursor="grab"
      width="220px"
      onDragEnd={(e) => {
        handleSetNodes(e, props.name);
      }}
    >
      <HStack>
        <ComponentIcon type={props.type as ComponentType} size="md" />
        <Text>{props.name}</Text>
        <Spacer />
        <DragHandleIcon
          width="14px"
          height="14px"
          color="gray.350"
          // {...attributes}
          // {...listeners}
        />
      </HStack>
    </Box>
  );
};
