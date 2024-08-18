import { Box, HStack, Text, useTheme, VStack } from "@chakra-ui/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
} from "@xyflow/react";

import { Handle, Position } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { FunctionIcon } from "../../components/icons/FunctionIcon";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { UndoRedo } from "./UndoRedo";

export default function OptimizationStudio() {
  const nodeTypes = useMemo(() => ({ component: Component }), []);
  const theme = useTheme();
  const gray100 = theme.colors.gray["100"];
  const gray300 = theme.colors.gray["300"];

  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } =
    useWorkflowStore(
      useShallow((state) => {
        if (typeof window !== "undefined") {
          window.state = state;
        }
        return {
          nodes: state.nodes,
          edges: state.edges,
          onNodesChange: state.onNodesChange,
          onEdgesChange: state.onEdgesChange,
          onConnect: state.onConnect,
        };
      })
    );

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <VStack width="full" height="full" spacing={0}>
        <HStack
          width="full"
          background="white"
          padding={2}
          borderBottom="1px solid"
          borderColor="gray.350"
        >
          <HStack width="full">
            <LogoIcon width={24} height={24} />
          </HStack>
          <HStack width="full" justify="center">
            <Text>Optimization Studio</Text>
          </HStack>
          <HStack width="full" justify="end">
            <UndoRedo />
          </HStack>
        </HStack>
        <Box width="full" height="full">
          <ReactFlow
            nodeTypes={nodeTypes}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            style={{ width: "100%", height: "100%" }}
          >
            <Controls />
            <MiniMap />
            <Background
              variant={BackgroundVariant.Dots}
              gap={12}
              size={2}
              bgColor={gray100}
              color={gray300}
            />
          </ReactFlow>
        </Box>
      </VStack>
    </div>
  );
}

function Component({ id }: { id: string }) {
  const SectionTitle = ({ children }: { children: React.ReactNode }) => {
    return (
      <Text
        fontSize={9}
        textTransform="uppercase"
        color="gray.500"
        fontWeight="bold"
      >
        {children}
      </Text>
    );
  };

  return (
    <VStack
      borderRadius="12px"
      background="white"
      padding="10px"
      spacing={2}
      align="start"
      color="gray.600"
      fontSize={11}
    >
      <HStack spacing="auto">
        <HStack spacing={2}>
          <ColorfulBlockIcon
            color="green.400"
            size="md"
            icon={<FunctionIcon />}
          />
          <Text fontSize={12}>GenerateQuery</Text>
        </HStack>
      </HStack>
      <SectionTitle>Inputs</SectionTitle>
      <HStack
        spacing={1}
        paddingX={2}
        paddingY={1}
        background="gray.100"
        borderRadius="8px"
        width="full"
        position="relative"
      >
        <Handle
          type="target"
          id="inputs.question"
          position={Position.Left}
          style={{
            marginLeft: "-10px",
            width: "8px",
            height: "8px",
            background: "white",
            borderRadius: "100%",
            border: `1px solid #FF8309`,
            boxShadow: `0px 0px 4px 0px #FF8309`,
          }}
        />
        <Text>question</Text>
        <Text color="gray.400">:</Text>
        <Text color="cyan.600" fontStyle="italic">
          str
        </Text>
      </HStack>
      <SectionTitle>Outputs</SectionTitle>
      <HStack
        spacing={1}
        paddingX={2}
        paddingY={1}
        background="gray.100"
        borderRadius="8px"
        width="full"
        position="relative"
      >
        <Handle
          type="source"
          id="outputs.query"
          position={Position.Right}
          style={{
            marginRight: "-10px",
            width: "8px",
            height: "8px",
            background: "white",
            borderRadius: "100%",
            border: `1px solid #2B6CB0`,
            boxShadow: `0px 0px 4px 0px #2B6CB0`,
          }}
        />
        <Text>query</Text>
        <Text color="gray.400">:</Text>
        <Text color="cyan.600" fontStyle="italic">
          str
        </Text>
      </HStack>
    </VStack>
  );
}

function ColorfulBlockIcon({
  color,
  size,
  icon,
}: {
  color: string;
  size: "sm" | "md" | "lg";
  icon: React.ReactNode;
}) {
  const sizeMap = {
    sm: "16px",
    md: "24px",
    lg: "32px",
  };
  const paddingMap = {
    sm: "2px",
    md: "3px",
    lg: "3px",
  };

  return (
    <Box
      backgroundColor={color}
      borderRadius="4px"
      padding={paddingMap[size]}
      width={sizeMap[size]}
      height={sizeMap[size]}
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      {icon}
    </Box>
  );
}
