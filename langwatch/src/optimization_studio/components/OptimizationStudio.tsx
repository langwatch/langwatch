import {
  Box,
  HStack,
  Text,
  Tooltip,
  useTheme,
  VStack,
  Flex,
} from "@chakra-ui/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  Panel,
} from "@xyflow/react";

import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { useDrop } from "react-dnd";

import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { UndoRedo } from "./UndoRedo";
import { History } from "./History";
import DefaultEdge from "./Edge";
import { PropertiesPanel } from "./properties/PropertiesPanel";
import { NodeSelectionPanel } from "./nodes/NodeSelectionPanel";
import { useSocketClient } from "../hooks/useSocketClient";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { titleCase } from "../../utils/stringCasing";
import Head from "next/head";
import { EntryNode } from "./nodes/EntryNode";
import { SignatureNode } from "./nodes/SignatureNode";
import { Link } from "@chakra-ui/next-js";
import { AutoSave } from "./AutoSave";
import { EvaluatorNode } from "./nodes/EvaluatorNode";
import { Evaluate } from "./Evaluate";

// New component that uses useDrop
function DragDropArea({ children }: { children: React.ReactNode }) {
  const [{ canDrop, isOver }, drop] = useDrop(() => ({
    accept: "node",
    drop: (item, monitor) => {
      const clientOffset = monitor.getClientOffset();
      if (clientOffset) {
        const { x, y } = clientOffset;
        return { name: "Studio", x, y }; // Return the name and the coordinates
      }
      return { name: "Studio" }; // Default return if no coordinates
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }));

  return (
    <Box
      ref={drop}
      width="full"
      height="full"
      border={canDrop ? `1px solid orange` : "1px solid transparent"}
    >
      {children}
    </Box>
  );
}

export default function OptimizationStudio() {
  const nodeTypes = useMemo(
    () => ({
      entry: EntryNode,
      signature: SignatureNode,
      evaluator: EvaluatorNode,
    }),
    []
  );
  const edgeTypes = useMemo(() => ({ default: DefaultEdge }), []);
  const theme = useTheme();
  const gray100 = theme.colors.gray["100"];
  const gray300 = theme.colors.gray["300"];

  const {
    name,
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    setWorkflowSelected,
  } = useWorkflowStore(
    useShallow((state) => {
      if (typeof window !== "undefined") {
        // @ts-ignore
        window.state = state;
      }
      return {
        name: state.name,
        nodes: state.nodes,
        edges: state.edges,
        onNodesChange: state.onNodesChange,
        onEdgesChange: state.onEdgesChange,
        onConnect: state.onConnect,
        setWorkflowSelected: state.setWorkflowSelected,
      };
    })
  );

  const { project } = useOrganizationTeamProject();
  const { socketStatus, connect, disconnect } = useSocketClient();

  useEffect(() => {
    if (!project) return;

    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect, project]);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Head>
        <title>LangWatch - Optimization Studio - {name}</title>
      </Head>
      <DndProvider backend={HTML5Backend}>
        <ReactFlowProvider>
          <VStack width="full" height="full" spacing={0}>
            <HStack
              width="full"
              background="white"
              padding={2}
              borderBottom="1px solid"
              borderColor="gray.350"
            >
              <HStack width="full">
                <Link href={`/${project?.slug}/workflows`}>
                  <LogoIcon width={24} height={24} />
                </Link>
                <AutoSave />
              </HStack>
              <HStack width="full" justify="center">
                <Text>Optimization Studio - {name}</Text>
                <StatusCircle
                  status={socketStatus}
                  tooltip={
                    socketStatus === "connecting-python" ||
                    socketStatus === "connecting-socket" ? (
                      <VStack align="start" spacing={1} padding={2}>
                        <HStack>
                          <StatusCircle
                            status={
                              socketStatus === "connecting-python"
                                ? "connected"
                                : "connecting"
                            }
                          />
                          <Text>Socket Connection</Text>
                        </HStack>
                        <HStack>
                          <StatusCircle status="connecting" />
                          <Text>Python Runtime</Text>
                        </HStack>
                      </VStack>
                    ) : (
                      titleCase(socketStatus)
                    )
                  }
                />
              </HStack>
              <HStack width="full" justify="end">
                <UndoRedo />
                <History />
              </HStack>
              <HStack justify="end" paddingLeft={2}>
                <Evaluate />
              </HStack>
            </HStack>
            <Box width="full" height="full" position="relative">
              <Flex width="full" height="full">
                <NodeSelectionPanel />
                <DragDropArea>
                  <ReactFlow
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    //  style={{ width: "100%", height: "100%" }}
                    onPaneClick={() => {
                      setWorkflowSelected(true);
                    }}
                    defaultViewport={{
                      zoom: 1,
                      x: 100,
                      y: Math.round(
                        ((typeof window !== "undefined"
                          ? window.innerHeight - 360
                          : 0) || 300) / 2
                      ),
                    }}
                  >
                    <Controls position="bottom-left" orientation="horizontal" />
                    <MiniMap />
                    <Background
                      variant={BackgroundVariant.Dots}
                      gap={12}
                      size={2}
                      bgColor={gray100}
                      color={gray300}
                    />
                  </ReactFlow>
                </DragDropArea>
                <PropertiesPanel />
              </Flex>
            </Box>
          </VStack>
        </ReactFlowProvider>
      </DndProvider>
    </div>
  );
}

function StatusCircle({
  status,
  tooltip,
}: {
  status: string;
  // For some misterious weird bug, we cannot wrap <StatusCircle /> in a <Tooltip />, the tooltip doesn't work, so we need to use it inside and pass the tooltip label as a prop.
  tooltip?: string | React.ReactNode;
}) {
  return (
    <Tooltip label={tooltip}>
      <Box
        width="12px"
        height="12px"
        background={
          status === "connected"
            ? "green.500"
            : status === "disconnected"
            ? "red.300"
            : "yellow.500"
        }
        borderRadius="full"
      />
    </Tooltip>
  );
}
