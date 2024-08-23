import { Box, HStack, Text, useTheme, VStack } from "@chakra-ui/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { EntryNode, SignatureNode } from "./Nodes";
import { UndoRedo } from "./UndoRedo";
import DefaultEdge from "./Edge";
import { PropertiesPanel } from "./PropertiesPanel";

export default function OptimizationStudio() {
  const nodeTypes = useMemo(
    () => ({ entry: EntryNode, signature: SignatureNode }),
    []
  );
  const edgeTypes = useMemo(() => ({ default: DefaultEdge }), []);
  const theme = useTheme();
  const gray100 = theme.colors.gray["100"];
  const gray300 = theme.colors.gray["300"];

  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } =
    useWorkflowStore(
      useShallow((state) => {
        if (typeof window !== "undefined") {
          // @ts-ignore
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
        <Box width="full" height="full" position="relative">
          <ReactFlow
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
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
          <PropertiesPanel />
        </Box>
      </VStack>
    </div>
  );
}
