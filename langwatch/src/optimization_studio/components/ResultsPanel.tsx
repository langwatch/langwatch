import {
  Alert,
  Box,
  Button,
  Center,
  EmptyState,
  HStack,
  type StackProps,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { X } from "react-feather";
import { LuSquareCheckBig } from "react-icons/lu";
import {
  BatchEvaluationResultsTable,
  type BatchRunSummary,
  BatchRunsSidebar,
  BatchSummaryFooter,
  transformBatchEvaluationData,
} from "../../components/batch-evaluation-results";
import { useBatchEvaluationState } from "../../components/experiments/BatchEvaluationV2";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { slugify } from "../../utils/slugify";
import { useRunEvalution } from "../hooks/useRunEvalution";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Entry, Workflow } from "../types/dsl";
import { getWorkflowEntryOutputs } from "../utils/workflowFields";
import { isExperimentQueryEnabled } from "./evaluationQueryEnabled";
import { OpenFullResultsButton } from "./OpenFullResultsButton";
import { RunViaApiButton } from "./RunViaApiButton";

export function ResultsPanel({
  isCollapsed,
  collapsePanel,
}: {
  isCollapsed: boolean;
  collapsePanel: (isCollapsed: boolean) => void;
}) {
  const { workflowId, experimentId, evaluationState } = useWorkflowStore(
    ({ workflow_id: workflowId, experiment_id: experimentId, state }) => ({
      workflowId,
      experimentId,
      evaluationState: state.evaluation,
    }),
  );

  return (
    <HStack
      display={isCollapsed ? "none" : undefined}
      background="bg"
      borderTop="2px solid"
      borderColor="border"
      width="full"
      fontSize="14px"
      height="full"
      align="start"
      position="relative"
    >
      <Button
        variant="ghost"
        onClick={() => collapsePanel(true)}
        position="absolute"
        top={1}
        right={1}
        size="xs"
        zIndex={1}
      >
        <X size={16} />
      </Button>
      <Tabs.Root
        value="evaluations"
        width="full"
        height="full"
        display="flex"
        flexDirection="column"
        size="sm"
        colorPalette="blue"
      >
        <Tabs.List borderBottomWidth="2px">
          <Tabs.Trigger value="evaluations">Evaluations</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content
          value="evaluations"
          padding={0}
          height="calc(100% - 32px)"
        >
          {!isCollapsed && (
            <EvaluationResults
              workflowId={workflowId}
              experimentId={experimentId}
              evaluationState={evaluationState}
            />
          )}
        </Tabs.Content>
      </Tabs.Root>
    </HStack>
  );
}

export function EvaluationResults({
  workflowId,
  experimentId,
  evaluationState,
  sidebarProps,
}: {
  workflowId?: string;
  experimentId?: string;
  evaluationState: Workflow["state"]["evaluation"];
  sidebarProps?: StackProps;
}) {
  const { project } = useOrganizationTeamProject();

  const [keepFetching, setKeepFetching] = useState(false);

  const experiment = api.experiments.getExperimentBySlugOrId.useQuery(
    {
      projectId: project?.id ?? "",
      experimentId: experimentId,
      experimentSlug: experimentId ? undefined : slugify(workflowId ?? ""),
    },
    {
      enabled: isExperimentQueryEnabled({
        hasProject: !!project,
        workflowId,
      }),
      refetchOnWindowFocus: false,
      refetchInterval: keepFetching ? 1 : undefined,
    },
  );

  useEffect(() => {
    if (evaluationState?.status === "running" && !experiment.data) {
      setKeepFetching(true);
    } else {
      setTimeout(
        () => {
          setKeepFetching(false);
        },
        experiment.data ? 0 : 15_000,
      );
    }
  }, [evaluationState?.status, experiment.data]);

  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(
    evaluationState?.run_id,
  );

  useEffect(() => {
    setSelectedRunId(evaluationState?.run_id);
  }, [evaluationState?.run_id]);

  const { stopEvaluation } = useRunEvalution();

  const { getWorkflow } = useWorkflowStore(({ getWorkflow }) => ({
    getWorkflow,
  }));

  const {
    selectedRun,
    isFinished,
    batchEvaluationRuns,
    selectedRunId: selectedRunId_,
  } = useBatchEvaluationState({
    project: project,
    experiment: experiment.data,
    selectedRunId,
    setSelectedRunId,
  });

  // Fetch selected run data for new table
  const runDataQuery = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    {
      projectId: project?.id ?? "",
      experimentId: experiment.data?.id ?? "",
      runId: selectedRunId_ ?? "",
    },
    {
      enabled: !!project && !!experiment.data && !!selectedRunId_,
      refetchInterval: !isFinished ? 1000 : false,
    },
  );

  // Transform run data for new table
  const transformedData = runDataQuery.data
    ? transformBatchEvaluationData(runDataQuery.data)
    : null;

  // Transform runs for new sidebar
  const sidebarRuns: BatchRunSummary[] = (
    batchEvaluationRuns.data?.runs ?? []
  ).map((run) => ({
    runId: run.runId,
    workflowVersion: run.workflowVersion,
    timestamps: run.timestamps,
    progress: run.progress,
    total: run.total,
    summary: {
      datasetCost: run.summary.datasetCost,
      evaluationsCost: run.summary.evaluationsCost,
      evaluations: Object.fromEntries(
        Object.entries(run.summary.evaluations).map(([id, ev]) => [
          id,
          {
            name: ev.name,
            averageScore: ev.averageScore,
            averagePassed: ev.averagePassed,
          },
        ]),
      ),
    },
  }));

  const sidebarSelectedRun = sidebarRuns.find(
    (r) => r.runId === selectedRunId_,
  );

  if (
    (experiment.isError && experiment.error.data?.httpStatus === 404) ||
    batchEvaluationRuns.data?.runs.length === 0 ||
    !experiment.data ||
    !project
  ) {
    if (keepFetching) {
      return <Text padding={4}>Loading...</Text>;
    }
    return (
      <Center width="full" height="full">
        <EmptyState.Root marginTop="-60px">
          <EmptyState.Content>
            <EmptyState.Indicator>
              <LuSquareCheckBig />
            </EmptyState.Indicator>
            <EmptyState.Title>Waiting for evaluation results</EmptyState.Title>
            <EmptyState.Description>
              Run your first evaluation to see the results here
            </EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      </Center>
    );
  }

  if (experiment.isError) {
    return (
      <Alert.Root status="error">
        <Alert.Indicator />
        Error loading evaluation results
      </Alert.Root>
    );
  }

  const evaluationStateRunId = evaluationState?.run_id;

  const workflow = getWorkflow();
  const entryFields = getWorkflowEntryOutputs(workflow);
  const entryDataset = (
    workflow.nodes.find((node) => node.type === "entry")?.data as
      | Entry
      | undefined
  )?.dataset;
  const datasetColumns =
    entryDataset?.inline?.columnTypes.map((column) => column.name) ?? [];

  return (
    <HStack align="stretch" width="full" height="full" gap={0}>
      <BatchRunsSidebar
        runs={sidebarRuns}
        selectedRunId={selectedRunId_}
        onSelectRun={setSelectedRunId}
        isLoading={batchEvaluationRuns.isLoading}
        size="sm"
        {...sidebarProps}
      />
      <VStack gap={0} width="full" height="full" minWidth="0" minHeight="0">
        {/* Table container with constrained height for virtualization */}
        <Box flex={1} width="full" minHeight="0" overflow="hidden">
          <BatchEvaluationResultsTable
            data={transformedData}
            isLoading={runDataQuery.isLoading}
          />
        </Box>
        {sidebarSelectedRun && (
          <BatchSummaryFooter
            run={sidebarSelectedRun}
            showProgress={
              (!selectedRun || selectedRun.runId === evaluationStateRunId) &&
              !!evaluationStateRunId &&
              evaluationState?.status === "running"
            }
            onStop={() =>
              stopEvaluation({
                run_id: evaluationStateRunId ?? "",
              })
            }
            actions={
              <HStack gap={2}>
                {workflowId && (
                  <RunViaApiButton
                    workflowId={workflowId}
                    entryFields={entryFields}
                    datasetColumns={datasetColumns}
                    datasetName={entryDataset?.name}
                    projectSlug={project.slug}
                  />
                )}
                {selectedRunId_ && (
                  <OpenFullResultsButton
                    projectSlug={project.slug}
                    experimentSlug={experiment.data.slug}
                    runId={selectedRunId_}
                  />
                )}
              </HStack>
            }
          />
        )}
      </VStack>
    </HStack>
  );
}
