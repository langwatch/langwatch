import {
  Box,
  Button,
  Center,
  Flex,
  HStack,
  Text,
  Tooltip,
  useTheme,
  VStack,
} from "@chakra-ui/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel as FlowPanel,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";

import { DndProvider, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import { Link } from "../ui/link";
import "@xyflow/react/dist/style.css";
import Head from "next/head";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart2 } from "react-feather";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { useShallow } from "zustand/react/shallow";
import { CurrentDrawer } from "../../components/CurrentDrawer";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { titleCase } from "../../utils/stringCasing";
import { useAskBeforeLeaving } from "../hooks/useAskBeforeLeaving";
import { useSocketClient } from "../hooks/useSocketClient";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { AutoSave } from "./AutoSave";
import { PlaygroundButton } from "./ChatWindow";
import DefaultEdge from "./Edge";
import { Evaluate } from "./Evaluate";
import { RunningStatus } from "./ExecutionState";
import { History } from "./History";
import { NodeComponents } from "./nodes";
import {
  CustomDragLayer,
  NodeSelectionPanel,
  NodeSelectionPanelButton,
} from "./NodeSelectionPanel";
import { Optimize } from "./Optimize";
import { ProgressToast } from "./ProgressToast";
import { PropertiesPanel } from "./properties/PropertiesPanel";
import { Publish } from "./Publish";
import { ResultsPanel } from "./ResultsPanel";
import { UndoRedo } from "./UndoRedo";
import { setRecentMenuLinkClick } from "../../components/DashboardLayout";

function DragDropArea({ children }: { children: React.ReactNode }) {
  const [_, drop] = useDrop(() => ({
    accept: "node",
    drop: (_item, monitor) => {
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
    <Box ref={drop} width="full" height="full">
      {children}
    </Box>
  );
}

export default function OptimizationStudio() {
  const nodeTypes = useMemo(() => NodeComponents, []);
  const edgeTypes = useMemo(() => ({ default: DefaultEdge }), []);

  const {
    name,
    nodes,
    edges,
    onNodesChange,
    onNodesDelete,
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
        onNodesDelete: state.onNodesDelete,
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
  const [isResultsPanelCollapsed, setIsResultsPanelCollapsed] = useState(false);

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
      (openResultsPanelRequest === "optimizations" && isResultsPanelCollapsed)
    ) {
      setDefaultTab(openResultsPanelRequest);
      panelRef.current?.expand(0);
      panelRef.current?.resize(6);

      const openTo = openResultsPanelRequest === "optimizations" ? 100 : 70;
      const step = () => {
        const size = panelRef.current?.getSize() ?? 0;
        if (size < openTo) {
          panelRef.current?.resize(size + 10);
          window.requestAnimationFrame(step);
        }
      };
      step();
    }
    if (openResultsPanelRequest === "closed" && !isResultsPanelCollapsed) {
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

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Head>
        <title>LangWatch - Optimization Studio - {name}</title>
      </Head>
      <ReactFlowProvider>
        <DndProvider backend={HTML5Backend}>
          <CustomDragLayer />
          <VStack width="full" height="full" spacing={0}>
            <HStack
              width="full"
              background="white"
              padding={2}
              borderBottom="1px solid"
              borderColor="gray.350"
            >
              <HStack width="full">
                <Link
                  href={`/${project?.slug}/workflows`}
                  onClick={() => {
                    setRecentMenuLinkClick(true);
                  }}
                >
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
                <Box />
                <Evaluate />

                <Optimize />
                <Publish isDisabled={socketStatus !== "connected"} />
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
                    <HStack
                      position="absolute"
                      bottom={3}
                      left={3}
                      zIndex={100}
                    >
                      <NodeSelectionPanelButton
                        isOpen={nodeSelectionPanelIsOpen}
                        setIsOpen={setNodeSelectionPanelIsOpen}
                      />
                      <Button
                        size="sm"
                        display={isResultsPanelCollapsed ? "block" : "none"}
                        background="white"
                        borderRadius={4}
                        borderColor="gray.350"
                        variant="outline"
                        onClick={() => {
                          panelRef.current?.expand(70);
                        }}
                      >
                        <HStack>
                          <BarChart2 size={14} />
                          <Text>Results</Text>
                        </HStack>
                      </Button>
                    </HStack>
                    {isResultsPanelCollapsed && <ProgressToast />}
                    <DragDropArea>
                      <ReactFlow
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onNodesDelete={() => setTimeout(onNodesDelete, 0)}
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
                              ? !isResultsPanelCollapsed
                                ? "16px"
                                : "122px"
                              : !isResultsPanelCollapsed
                              ? "180px"
                              : "262px",
                            marginBottom: "15px",
                          }}
                        />
                        <ReactFlowBackground />

                        <FlowPanel position="bottom-right">
                          <PlaygroundButton
                            nodes={nodes}
                            edges={edges}
                            executionStatus={executionStatus ?? ""}
                          />
                        </FlowPanel>
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
                    onCollapse={() => setIsResultsPanelCollapsed(true)}
                    onExpand={() => setIsResultsPanelCollapsed(false)}
                    defaultSize={0}
                  >
                    <ResultsPanel
                      isCollapsed={isResultsPanelCollapsed}
                      collapsePanel={collapsePanel}
                      defaultTab={defaultTab}
                    />
                  </Panel>
                </PanelGroup>
                <PropertiesPanel />
              </Flex>
            </Box>
          </VStack>
        </DndProvider>
      </ReactFlowProvider>
      <CurrentDrawer />
    </div>
  );
}

function ReactFlowBackground() {
  const theme = useTheme();
  const gray100 = theme.colors.gray["100"];
  const gray300 = theme.colors.gray["300"];

  return (
    <Background
      variant={BackgroundVariant.Dots}
      gap={12}
      size={2}
      bgColor={gray100}
      color={gray300}
    />
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
        minWidth="12px"
        maxWidth="12px"
        minHeight="12px"
        maxHeight="12px"
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
