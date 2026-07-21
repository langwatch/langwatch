import {
  Box,
  Button,
  Center,
  Flex,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type ReactFlowProps,
  ReactFlowProvider,
} from "@xyflow/react";

import { DndProvider, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart2 } from "react-feather";
import {
  type ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { useShallow } from "zustand/react/shallow";
import Head from "~/utils/compat/next-head";
import { CurrentDrawer } from "../../components/CurrentDrawer";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { GlobalUpgradeModal } from "../../components/UpgradeModal";
import {
  useColorMode,
  useColorModeValue,
  useColorRawValue,
} from "../../components/ui/color-mode";
import { Link } from "../../components/ui/link";
import { toaster } from "../../components/ui/toaster";
import { Tooltip } from "../../components/ui/tooltip";
import { GlobalTraceV2DrawerMount } from "../../features/traces-v2/components/GlobalTraceV2DrawerMount";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { titleCase } from "../../utils/stringCasing";
import { useAskBeforeLeaving } from "../hooks/useAskBeforeLeaving";
import { PostEventProvider, usePostEvent } from "../hooks/usePostEvent";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { isConnectionAllowed } from "../utils/controlFlow";
import { AutoSave } from "./AutoSave";
import { StudioNodeDrawer } from "./drawers/StudioNodeDrawer";
import DefaultEdge from "./Edge";
import { Evaluate } from "./Evaluate";
import { RunningStatus } from "./ExecutionState";
import { History } from "./History";
import {
  CustomDragLayer,
  NodeSelectionPanel,
  NodeSelectionPanelButton,
} from "./node-selection-panel/NodeSelectionPanel";
import { NodeComponents } from "./nodes";
import { Optimize } from "./Optimize";
import { ProgressToast } from "./ProgressToast";
import { Publish } from "./Publish";
import { ResultsPanel } from "./ResultsPanel";
import { RunUntilHereDialog } from "./RunUntilHereDialog";
import { UndoRedo } from "./UndoRedo";
import { WorkflowNamePopover } from "./WorkflowNamePopover";

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
  const {
    name,
    nodes,
    edges,
    onNodesChange,
    onNodesDelete,
    onEdgesChange,
    onConnect,
    onConnectStart,
    onConnectEnd,
    setIsDraggingNode,
    setClickedNodeId,
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
        onConnectStart: state.onConnectStart,
        onConnectEnd: state.onConnectEnd,
        setIsDraggingNode: state.setIsDraggingNode,
        setClickedNodeId: state.setClickedNodeId,
        openResultsPanelRequest: state.openResultsPanelRequest,
        setOpenResultsPanelRequest: state.setOpenResultsPanelRequest,
        executionStatus: state.state.execution?.status,
      };
    }),
  );

  const { project } = useOrganizationTeamProject();
  const { socketStatus } = usePostEvent();
  const { closeDrawer, currentDrawer } = useDrawer();

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

  useEffect(() => {
    if (openResultsPanelRequest === "evaluations") {
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
          <PostEventProvider>
            <CustomDragLayer />
            <VStack width="full" height="full" gap={0}>
              <HStack
                width="full"
                background="bg"
                padding={2}
                borderBottom="1px solid"
                borderColor="border.emphasized"
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
                  <WorkflowNamePopover />
                  <StatusCircle
                    status={socketStatus}
                    tooltip={
                      socketStatus === "connecting-python" ? (
                        <VStack align="start" gap={1} padding={2}>
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
                          background="bg"
                          borderRadius={4}
                          borderColor="border.emphasized"
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
                        <OptimizationStudioCanvas
                          nodes={nodes}
                          edges={edges}
                          onNodesChange={onNodesChange}
                          onEdgesChange={onEdgesChange}
                          onNodesDelete={() => setTimeout(onNodesDelete, 0)}
                          onConnect={(connection) => {
                            const result = onConnect(connection);
                            if (result?.error) {
                              toaster.create({
                                title: "Error",
                                description: result.error,
                                type: "error",
                                duration: 5000,
                                meta: {
                                  closable: true,
                                },
                              });
                            }
                          }}
                          onConnectStart={(_event, params) =>
                            onConnectStart({
                              nodeId: params.nodeId,
                              handleId: params.handleId,
                            })
                          }
                          onConnectEnd={() => onConnectEnd()}
                          isValidConnection={(connection) =>
                            isConnectionAllowed({ nodes, connection })
                          }
                          selectNodesOnDrag={false}
                          onNodeDragStart={() => {
                            setIsDraggingNode(true);
                          }}
                          onNodeDragStop={() => {
                            setIsDraggingNode(false);
                          }}
                          onPaneClick={() => {
                            if (currentDrawer) closeDrawer();
                          }}
                          onNodeClick={(_event, node) => {
                            if (currentDrawer) closeDrawer();
                            setClickedNodeId(node.id);
                          }}
                          fitView
                          fitViewOptions={{
                            maxZoom: 1.2,
                          }}
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
                        </OptimizationStudioCanvas>
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
                          background="bg.emphasized"
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
                      />
                    </Panel>
                  </PanelGroup>
                  <StudioNodeDrawer />
                </Flex>
              </Box>
            </VStack>
          </PostEventProvider>
        </DndProvider>
      </ReactFlowProvider>

      <CurrentDrawer marginTop={56} />
      <RunUntilHereDialog />
      {/* The studio route doesn't use DashboardLayout, so the v2 trace
          explorer needs its own mount here - without it, view-trace from
          the evaluations panel routes to traceV2Details (per the device
          opt-in) and renders nothing.
          See specs/traces-v2/drawer-opt-in-routing.feature. */}
      <GlobalTraceV2DrawerMount />
      {/* Same reason: the limit-exceeded dialog needs its own mount here -
          without it, plan-limited saves fired from inside the studio fail
          silently (the dialog only shows after navigating back to a
          dashboard page). See specs/workflows/studio-usage-limits.feature. */}
      <GlobalUpgradeModal />
    </div>
  );
}

function ReactFlowBackground() {
  const bgColor = useColorModeValue(
    useColorRawValue("gray.100"),
    useColorRawValue("gray.900"),
  );
  // Hardcoded to the pre-redesign grays (old gray.300 in light, a subtle dark
  // in dark). The theme gray scale shifted to darker Chakra v3 defaults, which
  // turned the canvas dots into a heavy grid; pin them so the texture stays the
  // light, subtle one it was for years rather than tracking the token.
  const dotColor = useColorModeValue("#E5E7EB", "#2d2d3d");

  return (
    <Background
      variant={BackgroundVariant.Dots}
      gap={12}
      size={2}
      bgColor={bgColor}
      color={dotColor}
    />
  );
}

function StatusCircle({
  status,
  tooltip,
}: {
  status: string;
  tooltip?: string | React.ReactNode;
}) {
  return (
    <Tooltip content={tooltip}>
      <HStack>
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
        {status !== "connected" && status != "disconnected" && (
          <HStack>
            <Text>Connecting...</Text>
            <Spinner size="sm" />
          </HStack>
        )}
      </HStack>
    </Tooltip>
  );
}

export function OptimizationStudioCanvas({
  children,
  defaultZoom = 1,
  yAdjust = -360,
  ...props
}: {
  children?: React.ReactNode;
  defaultZoom?: number;
  yAdjust?: number;
} & ReactFlowProps) {
  const nodeTypes = useMemo(() => NodeComponents, []);
  const edgeTypes = useMemo(() => ({ default: DefaultEdge }), []);
  const { colorMode } = useColorMode();

  return (
    <ReactFlow
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode={colorMode}
      // ReactFlow defaults deleteKeyCode to "Backspace" only; also bind Delete
      // so a selected node or connection is removable with either key.
      deleteKeyCode={["Backspace", "Delete"]}
      defaultViewport={{
        zoom: defaultZoom,
        x: 100,
        y: Math.round(
          ((typeof window !== "undefined" ? window.innerHeight - yAdjust : 0) ||
            300) / 2,
        ),
      }}
      proOptions={{ hideAttribution: true }}
      {...props}
    >
      <ReactFlowBackground />
      {children}
    </ReactFlow>
  );
}
