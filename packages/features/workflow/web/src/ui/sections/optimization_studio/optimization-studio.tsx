import { Box, Button, Center, Flex, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart2 } from "react-feather";
import {
  type ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { useShallow } from "zustand/react/shallow";
import Head from "../../elements/compat/next-head";
import { DatasetPreviewTable } from "@langwatch/dataset-web/components/datasets/editor/DatasetPreviewTable";
import { EvaluationProgressBar } from "@langwatch/experiment-web/components/experiments/BatchEvaluationV2/EvaluationProgressBar";
import { LogoIcon } from "../../elements/logo-icon";
import {
  useColorMode,
  useColorModeValue,
  useColorRawValue,
} from "@langwatch/design-system/color-mode";
import { Link } from "../../elements/studio-host/link";
import { toaster } from "../../../behavior/studio-host/toaster";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useDrawer } from "@langwatch/ui-host/use-drawer";
import { useOrganizationTeamProject } from "../../../behavior/studio-host/use-organization-team-project";
import { assertCrispChatHidden } from "../../../behavior/crisp-bubble-policy";
import { titleCase } from "@langwatch/design-system/string-casing";
import {
  useAskBeforeLeaving,
  type WorkflowEmojiPickerRenderProps,
  WorkflowAutosave,
  WorkflowEdge,
  WorkflowDragPreview,
  WorkflowNamePopover,
  WorkflowNodeSelectionPanel,
  WorkflowNodeSelectionPanelButton,
  WorkflowProgressToast,
  WorkflowRunUntilHereDialog,
  WorkflowRunningStatus,
  WorkflowUndoRedo,
  getWorkflowEntryNode,
  workflowNodeComponents,
} from "@langwatch/workflow-web";
import { PostEventProvider, usePostEvent } from "./use-post-event";
import { useWorkflowStore } from "@langwatch/workflow-web";
import { isConnectionAllowed } from "@langwatch/workflow-web";
import { WorkflowNodeHostProvider } from "@langwatch/workflow-web";
import {
  fieldSchema,
  getInputsOutputs,
  studioWorkflowWireSchema,
  studioWorkflowSchema,
  type Entry,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";
import { LLMModelDisplay } from "@langwatch/prompt-web/components/llmPromptConfigs/LLMModelDisplay";
import { HoverableBigText } from "../hoverable-big-text";
import { StudioNodeDrawer } from "./drawers/studio-node-drawer";
import { Evaluate } from "./evaluate";
import { History } from "./history";
import { ComponentIcon } from "@langwatch/workflow-web";
import { useComponentExecution } from "./use-component-execution";
import { useComponentVersion } from "../../../behavior/optimization_studio/use-component-version";
import { useGetDatasetData } from "../../../behavior/optimization_studio/use-get-dataset-data";
import { useAgentPickerFlow } from "../../../behavior/optimization_studio/use-agent-picker-flow";
import { useEvaluationExecution } from "./use-evaluation-execution";
import { useEvaluatorPickerFlow } from "../../../behavior/optimization_studio/use-evaluator-picker-flow";
import { useLoadWorkflow } from "../../../behavior/optimization_studio/use-load-workflow";
import { useOptimizationExecution } from "./use-optimization-execution";
import { usePromptPickerFlow } from "../../../behavior/optimization_studio/use-prompt-picker-flow";
import { useWorkflowExecution } from "./use-workflow-execution";
import { Optimize } from "./optimize";
import { EmojiPickerModal } from "./properties/modals/emoji-picker-modal";
import { Publish } from "./publish";
import { ResultsPanel } from "./results-panel";
import { DEFAULT_MODEL } from "../../../model/constants";
import { api } from "../../../behavior/studio-host/api";

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

  const [nodeSelectionPanelIsOpen, setNodeSelectionPanelIsOpen] = useState(true);

  const panelRef = useRef<ImperativePanelHandle>(null);
  const [isResultsPanelCollapsed, setIsResultsPanelCollapsed] = useState(false);

  const collapsePanel = () => {
    const panel = panelRef.current;
    if (panel) {
      panel.collapse();
    }
  };

  // The effect below clears the request it just handled, so its own dependency
  // flips mid-flight and an effect-scoped cleanup would cut the expand
  // animation short. The frame is tracked on a ref instead, cancelled on
  // unmount and whenever a fresh request arrives.
  const expandFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // A new request supersedes whatever the last one was still animating
    // towards. Without this an in-flight expand keeps resizing the panel back
    // up while a "closed" request is collapsing it. The cleared request that
    // this effect writes at the end is not a new one, so it must not cancel.
    if (openResultsPanelRequest !== undefined && expandFrameRef.current !== null) {
      window.cancelAnimationFrame(expandFrameRef.current);
      expandFrameRef.current = null;
    }

    if (openResultsPanelRequest === "evaluations") {
      panelRef.current?.expand(0);
      panelRef.current?.resize(6);

      const step = () => {
        const panel = panelRef.current;
        if (!panel) return;
        const size = panel.getSize();
        if (size < 70) {
          panel.resize(size + 10);
          expandFrameRef.current = window.requestAnimationFrame(step);
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

  useEffect(
    () => () => {
      if (expandFrameRef.current !== null) {
        window.cancelAnimationFrame(expandFrameRef.current);
      }
    },
    [],
  );

  // The Crisp bubble policy keeps the support bubble hidden app-wide unless
  // deliberately opened; re-assert on entering the studio so it can never
  // cover the canvas controls even if Crisp booted mid-navigation.
  useEffect(() => {
    assertCrispChatHidden();
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
            <WorkflowDragPreview />
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
                  <StudioWorkflowRunningStatus />
                  {!["waiting", "running"].includes(executionStatus ?? "") && (
                    <StudioWorkflowAutosave />
                  )}
                </HStack>
                <HStack width="full" justify="center">
                  <StudioWorkflowNamePopover />
                  <StatusCircle
                    status={socketStatus}
                    tooltip={
                      socketStatus === "connecting-python" ? (
                        <VStack align="start" gap={1} padding={2}>
                          <HStack>
                            <StatusCircle
                              status={
                                socketStatus === "connecting-python" ? "connected" : "connecting"
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
                  <StudioWorkflowUndoRedo />
                  <History />
                  <Box />
                  <Evaluate />

                  <Optimize />
                  <Publish isDisabled={socketStatus !== "connected"} />
                </HStack>
              </HStack>
              <Box width="full" height="full" position="relative">
                <Flex width="full" height="full">
                  <StudioWorkflowNodeSelectionPanel
                    isOpen={nodeSelectionPanelIsOpen}
                    setIsOpen={setNodeSelectionPanelIsOpen}
                  />
                  <PanelGroup direction="vertical">
                    <Panel style={{ position: "relative" }}>
                      <HStack position="absolute" bottom={3} left={3} zIndex={100}>
                        <StudioWorkflowNodeSelectionPanelButton
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
                      {isResultsPanelCollapsed && <StudioWorkflowProgressToast />}
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
                    <PanelResizeHandle style={{ position: "relative", marginTop: "-20px" }}>
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

      <StudioWorkflowRunUntilHereDialog />
      {/*
        THREE GLOBAL MOUNTS DID NOT TRAVEL, and each one is a real loss rather
        than an omission.

        `CurrentDrawer` is the application's drawer registry — it imports every
        drawer in the product — and `GlobalTraceV2DrawerMount` and
        `GlobalUpgradeModal` are the application's chrome for the same reason.
        The studio mounted its own copies because its address has no dashboard
        layout above it; a feature-web package can mount none of the three, and
        the composing application has no overlay slot to fill them from yet.

        What that costs, exactly: the node palette's pickers (`promptList`,
        `evaluatorList`, `agentList`, `addOrEditDataset`) still write their
        `?drawer.open=...` address, and nothing opens it; a trace opened from the
        results panel writes its address and nothing opens it; and a save
        refused by a plan limit reports as a failure notice rather than as the
        upgrade dialog. The navigation is correct and waiting for a drawer host
        in `apps/ui`. Recorded in this family's manifest row.
      */}
    </div>
  );
}

function ReactFlowBackground() {
  const bgColor = useColorModeValue(useColorRawValue("gray.100"), useColorRawValue("gray.900"));
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

function StatusCircle({ status, tooltip }: { status: string; tooltip?: string | React.ReactNode }) {
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
  const nodeTypes = useMemo(() => workflowNodeComponents, []);
  const edgeTypes = useMemo(() => ({ default: WorkflowEdge }), []);
  const { colorMode } = useColorMode();
  const useEntryDatasetTotal = (dataset: Entry["dataset"]) =>
    useGetDatasetData({ dataset, preview: true }).total;
  const nodeHost = {
    ComponentIcon,
    HoverableBigText,
    LLMModelDisplay,
    useColorModeValue,
    useComponentExecution,
    useComponentVersion,
    useEntryDatasetTotal,
  };

  return (
    <WorkflowNodeHostProvider value={nodeHost}>
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
            ((typeof window !== "undefined" ? window.innerHeight - yAdjust : 0) || 300) / 2,
          ),
        }}
        proOptions={{ hideAttribution: true }}
        {...props}
      >
        <ReactFlowBackground />
        {children}
      </ReactFlow>
    </WorkflowNodeHostProvider>
  );
}

function StudioWorkflowNodeSelectionPanel({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) {
  const { project } = useOrganizationTeamProject();
  const workflowId = useWorkflowStore((state) => state.workflow_id);
  const { handlePromptDragEnd } = usePromptPickerFlow();
  const { handleEvaluatorDragEnd } = useEvaluatorPickerFlow();
  const { handleAgentDragEnd } = useAgentPickerFlow();
  const resolvedDefault = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "workflows.create_default" },
    { enabled: !!project?.id },
  );
  const components = api.optimization.getComponents.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project?.id && !!workflowId,
      refetchOnWindowFocus: true,
    },
  );

  const customComponents = useMemo(() => {
    return (components.data ?? []).flatMap((component: any) => {
      if (!component.isComponent || !component.publishedId) {
        return [];
      }

      const publishedVersion = component.versions.find(
        (version: any) => version.id === component.publishedId,
      );
      if (!publishedVersion) {
        return [];
      }

      const workflow = studioWorkflowSchema.safeParse(publishedVersion.dsl);
      if (!workflow.success) {
        return [];
      }

      const fields = getInputsOutputs(workflow.data.edges, workflow.data.nodes);
      return [
        {
          id: component.id,
          name: component.name,
          publishedId: component.publishedId,
          inputs: normalizePaletteFields(fields.inputs),
          outputs: normalizePaletteFields(fields.outputs),
        },
      ];
    });
  }, [components.data]);

  return (
    <WorkflowNodeSelectionPanel
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      defaultModel={resolvedDefault.data?.model ?? DEFAULT_MODEL}
      customComponents={customComponents}
      onPromptDragEnd={handlePromptDragEnd}
      onEvaluatorDragEnd={handleEvaluatorDragEnd}
      onAgentDragEnd={handleAgentDragEnd}
    />
  );
}

function StudioWorkflowAutosave() {
  const { project } = useOrganizationTeamProject();
  const { workflow } = useLoadWorkflow();
  const autosave = api.workflow.autosave.useMutation();
  const trpc = api.useUtils();
  const onSave = useCallback(
    ({ dsl, setAsLatestVersion }: { dsl: StudioWorkflow; setAsLatestVersion: boolean }) => {
      if (!project || !workflow.data) {
        return Promise.reject(new Error("Workflow is not ready to autosave"));
      }
      return autosave.mutateAsync({
        projectId: project.id,
        workflowId: workflow.data.id,
        dsl: studioWorkflowWireSchema.parse(dsl),
        setAsLatestVersion,
      });
    },
    [autosave, project, workflow.data],
  );
  const onRefreshVersions = useCallback(async () => {
    if (!project || !workflow.data) {
      return;
    }
    await trpc.workflow.getVersions.refetch({
      workflowId: workflow.data.id,
      projectId: project.id,
      returnDSL: "previousVersion",
    });
  }, [project, trpc.workflow.getVersions, workflow.data]);

  return (
    <WorkflowAutosave
      isWorkflowReady={!!project && !!workflow.data}
      onSave={onSave}
      onRefreshVersions={onRefreshVersions}
    />
  );
}

function StudioWorkflowRunningStatus({ isLoading }: { isLoading?: boolean }) {
  const { stopWorkflowExecution } = useWorkflowExecution();

  return (
    <WorkflowRunningStatus
      isLoading={isLoading}
      onStop={({ traceId }) => stopWorkflowExecution({ trace_id: traceId })}
    />
  );
}

function StudioWorkflowRunUntilHereDialog() {
  const dataset = useWorkflowStore((state) => getWorkflowEntryNode(state.nodes)?.data.dataset);
  const { rows, columns } = useGetDatasetData({ dataset });
  const { startWorkflowExecution } = useWorkflowExecution();

  return (
    <WorkflowRunUntilHereDialog
      datasetRows={rows}
      datasetColumns={columns}
      onStartWorkflowExecution={startWorkflowExecution}
      renderDatasetPreview={({ rows: previewRows, columns: previewColumns, onRowClick }) => (
        <DatasetPreviewTable
          rows={previewRows}
          columns={previewColumns}
          background="bg.panel"
          onRowClick={onRowClick}
        />
      )}
    />
  );
}

function StudioWorkflowUndoRedo() {
  const { workflow } = useLoadWorkflow();
  return <WorkflowUndoRedo isWorkflowLoaded={workflow.isFetched} />;
}

function StudioWorkflowNamePopover() {
  return <WorkflowNamePopover renderEmojiPicker={renderWorkflowEmojiPicker} />;
}

function StudioWorkflowProgressToast() {
  const { stopEvaluationExecution } = useEvaluationExecution();
  const { stopOptimizationExecution } = useOptimizationExecution();

  return (
    <WorkflowProgressToast
      renderEvaluationProgress={(state) => <EvaluationProgressBar evaluationState={state} />}
      onStopEvaluation={({ runId }) => stopEvaluationExecution({ run_id: runId })}
      onStopOptimization={({ runId }) => stopOptimizationExecution({ run_id: runId })}
    />
  );
}

const StudioWorkflowNodeSelectionPanelButton = WorkflowNodeSelectionPanelButton;

function renderWorkflowEmojiPicker(props: WorkflowEmojiPickerRenderProps) {
  return <EmojiPickerModal {...props} />;
}

function normalizePaletteFields(fields: unknown[] | undefined) {
  return (fields ?? []).flatMap((field) => {
    const parsed = fieldSchema.safeParse(field);
    return parsed.success ? [parsed.data] : [];
  });
}
