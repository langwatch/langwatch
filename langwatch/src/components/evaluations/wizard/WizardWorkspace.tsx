import { Box, Card, Tabs, VStack } from "@chakra-ui/react";
import { DatasetTable } from "../../datasets/DatasetTable";
import {
  useEvaluationWizardStore,
  type State,
} from "~/hooks/useEvaluationWizardStore";
import { OptimizationStudioCanvas } from "../../../optimization_studio/components/OptimizationStudio";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Controls, ReactFlowProvider, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";
import { EvaluationResults } from "../../../optimization_studio/components/ResultsPanel";

export function WizardWorkspace() {
  const { getDatasetId, wizardState, setWizardState, dsl } =
    useEvaluationWizardStore();

  const hasDataset = !!getDatasetId();
  const hasWorkflow = dsl.nodes.length > 0;
  const hasResults = hasDataset && hasWorkflow;

  return (
    <VStack
      background="url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSIjRjJGNEY4Ii8+CjxyZWN0IHg9IjE0IiB5PSIxNCIgd2lkdGg9IjIiIGhlaWdodD0iMiIgZmlsbD0iI0U1RTdFQiIvPgo8L3N2Zz4K)"
      padding={6}
      width="full"
      height="100%"
      minHeight="calc(100vh - 50px)"
      borderLeft="1px solid"
      borderLeftColor="gray.200"
    >
      {(hasDataset || hasWorkflow || hasResults) && (
        <Tabs.Root
          width="full"
          height="full"
          display="flex"
          flexDirection="column"
          variant="enclosed"
          value={wizardState.workspaceTab}
          onValueChange={(e) => {
            setWizardState({
              workspaceTab: e.value as State["wizardState"]["workspaceTab"],
            });
          }}
        >
          <Tabs.List
            width="fit"
            background="gray.200"
            colorPalette="blue"
            alignSelf="center"
            position="sticky"
            top="16px"
            flexShrink={0}
          >
            {hasDataset && <Tabs.Trigger value="dataset">Dataset</Tabs.Trigger>}
            {hasWorkflow && (
              <Tabs.Trigger value="workflow">Workflow</Tabs.Trigger>
            )}
            {hasResults && <Tabs.Trigger value="results">Results</Tabs.Trigger>}
          </Tabs.List>
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
                    <DatasetTable datasetId={getDatasetId()} insideWizard />
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
              <ReactFlowProvider>
                <DndProvider backend={HTML5Backend}>
                  {wizardState.workspaceTab === "workflow" && (
                    <WizardOptimizationStudioCanvas />
                  )}
                </DndProvider>
              </ReactFlowProvider>
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
                <Card.Body width="full" height="full" paddingBottom={6}>
                  <EvaluationResults
                    workflowId={dsl.workflow_id}
                    evaluationState={dsl.state.evaluation}
                  />
                </Card.Body>
              </Card.Root>
            </Tabs.Content>
          )}
        </Tabs.Root>
      )}
    </VStack>
  );
}

function WizardOptimizationStudioCanvas() {
  const { dsl, onNodesChange, onEdgesChange, onConnect } =
    useEvaluationWizardStore();

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
      onConnect={onConnect}
      fitView={dsl.nodes.length > 1}
    >
      <Controls position="bottom-center" orientation="horizontal" />
    </OptimizationStudioCanvas>
  );
}
