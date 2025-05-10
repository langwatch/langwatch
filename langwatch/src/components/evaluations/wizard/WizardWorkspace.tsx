import {
  Box,
  Button,
  Card,
  HStack,
  Spacer,
  Tabs,
  VStack,
} from "@chakra-ui/react";
import { DatasetTable } from "../../datasets/DatasetTable";
import {
  useEvaluationWizardStore,
  type State,
} from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { OptimizationStudioCanvas } from "../../../optimization_studio/components/OptimizationStudio";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Controls, useUpdateNodeInternals } from "@xyflow/react";
import { memo, useEffect, useRef } from "react";
import { EvaluationResults } from "../../../optimization_studio/components/ResultsPanel";
import { useShallow } from "zustand/react/shallow";
import { EvaluationManualIntegration } from "../../checks/EvaluationManualIntegration";
import { useAvailableEvaluators } from "../../../hooks/useAvailableEvaluators";
import type { AgGridReact } from "@ag-grid-community/react";
import { toaster } from "../../ui/toaster";
import { Link } from "../../ui/link";
import { LuArrowUpRight } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { CopilotWorkspace } from "./components/copilot/CopilotWorkspace";

export const WizardWorkspace = memo(function WizardWorkspace() {
  const {
    getDatasetId,
    workspaceTab: workspaceTab_,
    setWizardState,
    workflowId,
    experimentId,
    evaluationState,
    task,
    hasWorkflow,
    hasCodeImplementation,
    setDatasetGridRef,
    isCopilot,
  } = useEvaluationWizardStore(
    useShallow((state) => ({
      getDatasetId: state.getDatasetId,
      workspaceTab: state.wizardState.workspaceTab,
      setWizardState: state.setWizardState,
      workflowId: state.workflowStore.workflow_id,
      experimentId: state.workflowStore.experiment_id,
      evaluationState: state.workflowStore.state.evaluation,
      nodes: state.workflowStore.nodes,
      task: state.wizardState.task,
      hasWorkflow: state.workflowStore.nodes.length > 0,
      hasCodeImplementation:
        !!state.getFirstEvaluatorNode() &&
        (state.wizardState.executionMethod === "realtime_guardrail" ||
          state.wizardState.executionMethod === "realtime_manually"),
      setDatasetGridRef: state.setDatasetGridRef,
      isCopilot: state.isCopilot,
    }))
  );

  const datasetGridRef = useRef<AgGridReact<any>>(null);
  const { project } = useOrganizationTeamProject();

  const hasDataset = !!getDatasetId();
  const hasResults = hasDataset && hasWorkflow;

  useEffect(() => {
    setDatasetGridRef(datasetGridRef);
  }, [datasetGridRef, setDatasetGridRef]);

  // Fix for not falling into a tab that doesn't exist, fallback to first available tab
  const availableTabs = {
    dataset: hasDataset,
    workflow: hasWorkflow,
    results: hasResults,
    "code-implementation": hasCodeImplementation,
  };
  const firstAvailableTab = Object.entries(availableTabs).find(
    ([_, hasTab]) => hasTab
  )?.[0];
  const workspaceTab =
    workspaceTab_ && !availableTabs[workspaceTab_]
      ? firstAvailableTab
      : workspaceTab_;
  
  return (
    <VStack
      background="url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSIjRjJGNEY4Ii8+CjxyZWN0IHg9IjE0IiB5PSIxNCIgd2lkdGg9IjIiIGhlaWdodD0iMiIgZmlsbD0iI0U1RTdFQiIvPgo8L3N2Zz4K)"
      padding={6}
      width="full"
      height="100%"
      minHeight="calc(100vh - 50px)"
      borderLeft="1px solid"
      borderLeftColor="gray.200"
      borderTop="1px solid"
      borderTopColor="gray.200"
      minWidth="0"
      gap={0}
      borderRadius="8px 0 0 0"
    >
      {isCopilot && <CopilotWorkspace />}
      {!isCopilot && (hasDataset || hasWorkflow || hasResults) && (
        <Tabs.Root
          width="full"
          height="full"
          display="flex"
          flexDirection="column"
          variant="enclosed"
          value={workspaceTab}
          onValueChange={(e) => {
            setWizardState({
              workspaceTab: e.value as State["wizardState"]["workspaceTab"],
            });
          }}
        >
          <HStack width="full" alignItems="center">
            <HStack width="full" />
            <Tabs.List
              width="fit"
              background="gray.200"
              colorPalette="blue"
              alignSelf="center"
              position="sticky"
              top="0px"
              flexShrink={0}
            >
              {hasDataset && (
                <Tabs.Trigger value="dataset">Dataset</Tabs.Trigger>
              )}
              {hasWorkflow && (
                <Tabs.Trigger value="workflow">Workflow</Tabs.Trigger>
              )}
              {hasResults && (
                <Tabs.Trigger value="results">
                  {task === "real_time" ? "Trial Results" : "Results"}
                </Tabs.Trigger>
              )}
              {hasCodeImplementation && (
                <Tabs.Trigger value="code-implementation">Code</Tabs.Trigger>
              )}
            </Tabs.List>
            <HStack width="full" justifyContent="end">
              {workflowId && workspaceTab === "workflow" && (
                <Link href={`/${project?.slug}/studio/${workflowId}`} asChild>
                  <Button variant="outline" size="sm">
                    <LuArrowUpRight />
                    Open Full Workflow
                  </Button>
                </Link>
              )}
            </HStack>
          </HStack>
          {hasDataset && (
            <Tabs.Content
              value="dataset"
              width="full"
              maxHeight="calc(100vh - 150px)"
              position="sticky"
              top="58px"
            >
              <Card.Root width="full" position="sticky" top={6}>
                <Card.Body width="full" paddingBottom={6}>
                  <Box width="full" position="relative">
                    <DatasetTable
                      datasetId={getDatasetId()}
                      insideWizard
                      gridRef={datasetGridRef}
                    />
                  </Box>
                </Card.Body>
              </Card.Root>
            </Tabs.Content>
          )}
          {hasWorkflow && (
            <Tabs.Content
              value="workflow"
              width="full"
              height="full"
              maxHeight="calc(100vh - 150px)"
              position="sticky"
              top="58px"
            >
              <DndProvider backend={HTML5Backend}>
                {workspaceTab === "workflow" && (
                  <WizardOptimizationStudioCanvas />
                )}
              </DndProvider>
            </Tabs.Content>
          )}
          {hasResults && (
            <Tabs.Content
              value="results"
              width="full"
              height="fit-content"
              minHeight="calc(100vh - 150px)"
              position="sticky"
              top="58px"
            >
              <Card.Root width="full" height="full" position="sticky" top={6}>
                <Card.Body width="full" height="full" padding={0}>
                  <EvaluationResults
                    workflowId={workflowId}
                    experimentId={experimentId}
                    evaluationState={evaluationState}
                    sidebarProps={{
                      padding: 2,
                      borderRadius: "6px 0 0 6px",
                    }}
                  />
                </Card.Body>
              </Card.Root>
            </Tabs.Content>
          )}
          {hasCodeImplementation && (
            <Tabs.Content
              value="code-implementation"
              width="full"
              height="full"
            >
              <CodeImplementation />
            </Tabs.Content>
          )}
        </Tabs.Root>
      )}
    </VStack>
  );
});

const WizardOptimizationStudioCanvas = memo(
  function WizardOptimizationStudioCanvas() {
    const { dsl, onNodesChange, onEdgesChange, onConnect } =
      useEvaluationWizardStore(
        useShallow((state) => ({
          dsl: state.getDSL(),
          onNodesChange: state.workflowStore.onNodesChange,
          onEdgesChange: state.workflowStore.onEdgesChange,
          onConnect: state.workflowStore.onConnect,
        }))
      );

    const updateNodeInternals = useUpdateNodeInternals();

    useEffect(() => {
      for (const node of dsl.nodes) {
        updateNodeInternals(node.id);
      }
    }, [dsl, updateNodeInternals]);

    return (
      <OptimizationStudioCanvas
        nodes={dsl.nodes}
        edges={dsl.edges}
        defaultZoom={1}
        yAdjust={560}
        style={{
          border: "1px solid #DDD",
          borderRadius: "8px",
        }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onBeforeDelete={() => {
          // We don't delete nodes in the wizard
          return Promise.resolve(false);
        }}
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
        fitView
        fitViewOptions={{
          maxZoom: 1.2,
        }}
      >
        <Controls position="bottom-center" orientation="horizontal" />
      </OptimizationStudioCanvas>
    );
  }
);

function CodeImplementation() {
  const { name, checkType, executionMethod, settings } =
    useEvaluationWizardStore(
      useShallow((state) => ({
        name: state.wizardState.name,
        checkType: state.getFirstEvaluatorNode()?.data.evaluator,
        executionMethod: state.wizardState.executionMethod,
        settings: Object.fromEntries(
          state
            .getFirstEvaluatorNode()
            ?.data.parameters?.map((field) => [
              field.identifier,
              field.value,
            ]) ?? []
        ),
      }))
    );

  const availableEvaluators = useAvailableEvaluators();

  if (!checkType || !availableEvaluators) return null;

  return (
    <Card.Root width="full" height="full" position="sticky" top={6}>
      <Card.Body width="full" height="full" paddingTop={0}>
        {availableEvaluators[checkType] && (
          <EvaluationManualIntegration
            evaluatorDefinition={availableEvaluators[checkType]!}
            checkType={checkType}
            name={name ?? "Untitled"}
            executionMode={
              executionMethod === "realtime_guardrail"
                ? "AS_GUARDRAIL"
                : "MANUALLY"
            }
            settings={settings}
            storeSettingsOnCode={true}
          />
        )}
      </Card.Body>
    </Card.Root>
  );
}
