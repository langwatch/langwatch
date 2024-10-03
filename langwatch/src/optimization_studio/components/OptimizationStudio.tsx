import {
  Box,
  Center,
  Flex,
  HStack,
  Text,
  Tooltip,
  useTheme,
  VStack,
  useDisclosure,
  Button,
} from "@chakra-ui/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  Panel as FlowPanel,
} from "@xyflow/react";

import { DndProvider, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import { Link } from "@chakra-ui/next-js";
import "@xyflow/react/dist/style.css";
import Head from "next/head";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { useShallow } from "zustand/react/shallow";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { titleCase } from "../../utils/stringCasing";
import { useSocketClient } from "../hooks/useSocketClient";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { AutoSave } from "./AutoSave";
import DefaultEdge from "./Edge";
import { Evaluate } from "./Evaluate";
import { History } from "./History";
import { EntryNode } from "./nodes/EntryNode";
import { EvaluatorNode } from "./nodes/EvaluatorNode";
import {
  NodeSelectionPanel,
  NodeSelectionPanelButton,
} from "./nodes/NodeSelectionPanel";
import { SignatureNode } from "./nodes/SignatureNode";
import { ProgressToast } from "./ProgressToast";
import { PropertiesPanel } from "./properties/PropertiesPanel";
import { ResultsPanel } from "./ResultsPanel";
import { UndoRedo } from "./UndoRedo";
import { useAskBeforeLeaving } from "../hooks/useAskBeforeLeaving";
import { RunningStatus } from "./ExecutionState";
import { CurrentDrawer } from "../../components/CurrentDrawer";
import { Optimize } from "./Optimize";
import { ChatWindow } from "./ChatWindow";

// New component that uses useDrop
function DragDropArea({ children }: { children: React.ReactNode }) {
  const [{ canDrop }, drop] = useDrop(() => ({
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
      boxShadow={canDrop ? "inset 0 0 0 1px orange" : undefined}
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
    openResultsPanelRequest,
    setOpenResultsPanelRequest,
    executionStatus,
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
        openResultsPanelRequest: state.openResultsPanelRequest,
        setOpenResultsPanelRequest: state.setOpenResultsPanelRequest,
        executionStatus: state.state.execution?.status,
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

  const [nodeSelectionPanelIsOpen, setNodeSelectionPanelIsOpen] =
    useState(true);

  const panelRef = useRef<ImperativePanelHandle>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  const collapsePanel = () => {
    const panel = panelRef.current;
    if (panel) {
      panel.collapse();
    }
  };

  const [defaultTab, setDefaultTab] = useState<"evaluations" | "optimizations">(
    "evaluations"
  );

  useEffect(() => {
    if (
      openResultsPanelRequest === "evaluations" ||
      (openResultsPanelRequest === "optimizations" && isPanelCollapsed)
    ) {
      setDefaultTab(openResultsPanelRequest);
      panelRef.current?.expand(0);
      panelRef.current?.resize(6);
      const step = () => {
        const size = panelRef.current?.getSize() ?? 0;
        if (size < 70) {
          panelRef.current?.resize(size + 10);
          window.requestAnimationFrame(step);
        }
      };
      step();
    }
    if (openResultsPanelRequest === "closed" && !isPanelCollapsed) {
      panelRef.current?.collapse();
    }
    setOpenResultsPanelRequest(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openResultsPanelRequest]);

  useEffect(() => {
    if (typeof window === "undefined" || !("$crisp" in window)) {
      return;
    }

    // @ts-ignore
    window.$crisp.push(["do", "chat:hide"]);

    return () => {
      // @ts-ignore
      window.$crisp.push(["do", "chat:show"]);
    };
  }, []);

  useAskBeforeLeaving();

  const chatModal = useDisclosure();

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Head>
        <title>LangWatch - Optimization Studio - {name}</title>
      </Head>
      <ChatWindow isOpen={chatModal.isOpen} onClose={chatModal.onClose} />
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
                <RunningStatus />
                {!["waiting", "running"].includes(executionStatus ?? "") && (
                  <AutoSave />
                )}
              </HStack>
              <HStack width="full" justify="center">
                <Text noOfLines={1} fontSize="15px">
                  Optimization Studio - {name}
                </Text>
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
                <Optimize />
              </HStack>
            </HStack>
            <Box width="full" height="full" position="relative">
              <Flex width="full" height="full">
                <NodeSelectionPanel
                  isOpen={nodeSelectionPanelIsOpen}
                  setIsOpen={setNodeSelectionPanelIsOpen}
                />
                <PanelGroup direction="vertical">
                  <Panel style={{ position: "relative" }}>
                    <NodeSelectionPanelButton
                      isOpen={nodeSelectionPanelIsOpen}
                      setIsOpen={setNodeSelectionPanelIsOpen}
                    />
                    {isPanelCollapsed && <ProgressToast />}
                    <DragDropArea>
                      <ReactFlow
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
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
                        proOptions={{ hideAttribution: true }}
                      >
                        <Controls
                          position="bottom-left"
                          orientation="horizontal"
                          style={{
                            marginLeft: nodeSelectionPanelIsOpen
                              ? "16px"
                              : "80px",
                            marginBottom: "18px",
                          }}
                        />
                        <Background
                          variant={BackgroundVariant.Dots}
                          gap={12}
                          size={2}
                          bgColor={gray100}
                          color={gray300}
                        />
                        {socketStatus === "connected" && (
                          <FlowPanel position="bottom-right">
                            <Button onClick={chatModal.onOpen}>Chat</Button>
                          </FlowPanel>
                        )}
                      </ReactFlow>
                    </DragDropArea>
                  </Panel>
                  <PanelResizeHandle
                    style={{ position: "relative", marginTop: "-20px" }}
                  >
                    <Center paddingY={2}>
                      <Box
                        width="30px"
                        height="3px"
                        borderRadius="full"
                        background="gray.400"
                      />
                    </Center>
                  </PanelResizeHandle>
                  <Panel
                    collapsible
                    minSize={6}
                    ref={panelRef}
                    onCollapse={() => setIsPanelCollapsed(true)}
                    onExpand={() => setIsPanelCollapsed(false)}
                    defaultSize={0}
                  >
                    {!isPanelCollapsed && (
                      <ResultsPanel
                        collapsePanel={collapsePanel}
                        defaultTab={defaultTab}
                      />
                    )}
                  </Panel>
                </PanelGroup>
                <PropertiesPanel />
              </Flex>
            </Box>
          </VStack>
        </ReactFlowProvider>
      </DndProvider>
      <CurrentDrawer />
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
