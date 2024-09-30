import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { X } from "react-feather";
import {
  BatchEvaluationV2EvaluationResults,
  BatchEvaluationV2EvaluationSummary,
  BatchEvaluationV2RunList,
  useBatchEvaluationState,
} from "../../components/experiments/BatchEvaluationV2";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { experimentSlugify } from "../../server/experiments/utils";
import { api } from "../../utils/api";
import { useEvaluationExecution } from "../hooks/useEvaluationExecution";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { EvaluationProgressBar } from "./ProgressToast";
import {
  DSPyExperimentRunList,
  DSPyRunsScoresChart,
  RunDetails,
  useDSPyExperimentState,
} from "../../components/experiments/DSPyExperiment";
import type { Experiment, Project } from "@prisma/client";

export function ResultsPanel({
  collapsePanel,
  defaultTab,
}: {
  collapsePanel: (isCollapsed: boolean) => void;
  defaultTab: "evaluations" | "optimizations";
}) {
  return (
    <HStack
      background="white"
      borderTop="2px solid"
      borderColor="gray.200"
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
      <Tabs
        width="full"
        height="full"
        display="flex"
        flexDirection="column"
        size="sm"
        defaultIndex={defaultTab === "evaluations" ? 0 : 1}
      >
        <TabList>
          <Tab>Evaluations</Tab>
          <Tab>Optimizations</Tab>
        </TabList>
        <TabPanels minHeight="0" height="full">
          <TabPanel padding={0} height="full">
            <EvaluationResults />
          </TabPanel>
          <TabPanel padding={0} height="full">
            <OptimizationResults />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </HStack>
  );
}

export function EvaluationResults() {
  const { workflowId, evaluationState } = useWorkflowStore(
    ({ workflow_id: workflowId, state }) => ({
      workflowId,
      evaluationState: state.evaluation,
    })
  );

  const { project } = useOrganizationTeamProject();

  const experiment = api.experiments.getExperimentBySlug.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: experimentSlugify(workflowId ?? ""),
    },
    {
      enabled: !!project && !!workflowId,
      refetchOnWindowFocus: false,
    }
  );

  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(
    evaluationState?.run_id
  );

  const { stopEvaluationExecution } = useEvaluationExecution();

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

  if (experiment.isError && experiment.error.data?.httpStatus === 404) {
    return <Text padding={4}>No evaluations started yet</Text>;
  }

  if (experiment.isError) {
    return (
      <Alert status="error">
        <AlertIcon />
        Error loading evaluation results
      </Alert>
    );
  }

  if (!experiment.data || !project) {
    return <Text padding={4}>Loading...</Text>;
  }

  const evaluationStateRunId = evaluationState?.run_id;

  return (
    <HStack align="start" width="full" height="full" spacing={0}>
      <BatchEvaluationV2RunList
        batchEvaluationRuns={batchEvaluationRuns}
        selectedRun={selectedRun}
        selectedRunId={selectedRunId_}
        setSelectedRunId={setSelectedRunId}
        size="sm"
      />
      <VStack spacing={0} width="full" height="full" minWidth="0">
        <BatchEvaluationV2EvaluationResults
          project={project}
          experiment={experiment.data}
          runId={selectedRunId_}
          isFinished={isFinished}
          size="sm"
        />
        <Spacer />
        {selectedRun && (
          <BatchEvaluationV2EvaluationSummary run={selectedRun} />
        )}
        {(!selectedRun || selectedRun.run_id === evaluationStateRunId) &&
          evaluationStateRunId &&
          evaluationState?.status === "running" && (
            <HStack
              width="full"
              padding={3}
              borderTop="1px solid"
              borderColor="gray.200"
            >
              <Text whiteSpace="nowrap" marginTop="-1px" paddingX={2}>
                Running
              </Text>
              <EvaluationProgressBar size="lg" />
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  stopEvaluationExecution({
                    run_id: evaluationStateRunId,
                  })
                }
                minHeight="28px"
                minWidth="28px"
                padding="6px"
              >
                <X />
              </Button>
            </HStack>
          )}
      </VStack>
    </HStack>
  );
}

export function OptimizationResults() {
  const { workflowId } = useWorkflowStore(({ workflow_id: workflowId }) => ({
    workflowId,
  }));

  const { project } = useOrganizationTeamProject();

  const experiment = api.experiments.getExperimentBySlug.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: experimentSlugify(`${workflowId ?? ""}-optimizations`),
    },
    {
      enabled: !!project && !!workflowId,
      refetchOnWindowFocus: false,
    }
  );

  if (experiment.isError && experiment.error.data?.httpStatus === 404) {
    return <Text padding={4}>No optimizations started yet</Text>;
  }

  if (experiment.isError) {
    return (
      <Alert status="error">
        <AlertIcon />
        Error loading optimization results
      </Alert>
    );
  }

  if (!experiment.data || !project) {
    return <Text padding={4}>Loading...</Text>;
  }

  return (
    <LoadedOptimizationResults experiment={experiment.data} project={project} />
  );
}

export function LoadedOptimizationResults({
  experiment,
  project,
}: {
  experiment: Experiment;
  project: Project;
}) {
  const {
    dspyRuns,
    selectedRuns,
    highlightedRun,
    setHighlightedRun,
    selectedPoint,
    setSelectedPoint,
    dspyRunsPlusIncoming,
    stepToDisplay,
    labelNames,
    runsById,
    optimizerNames,
  } = useDSPyExperimentState({ project, experiment });

  return (
    <HStack align="start" width="full" height="full" spacing={0}>
      <DSPyExperimentRunList
        dspyRuns={dspyRuns}
        selectedRuns={selectedRuns}
        setHighlightedRun={setHighlightedRun}
        dspyRunsPlusIncoming={dspyRunsPlusIncoming}
        size="sm"
      />
      <VStack
        align="start"
        width="100%"
        maxWidth="1200px"
        height="full"
        overflowY="auto"
        spacing={0}
      >
        {dspyRuns.isLoading ? (
          <Skeleton width="100%" height="30px" />
        ) : dspyRuns.error ? (
          <Alert status="error">
            <AlertIcon />
            Error loading experiment runs
          </Alert>
        ) : dspyRuns.data?.length === 0 ? (
          <Text>Waiting for the first completed step to arrive...</Text>
        ) : (
          dspyRuns.data && (
            <>
              <VStack width="full" paddingX={1} paddingY={2} align="start">
                <Heading as="h2" size="sm" paddingLeft={4} paddingTop={2}>
                  {optimizerNames.length == 1
                    ? optimizerNames[0]!
                    : optimizerNames.length > 1
                    ? "Multiple Optimizers"
                    : "Waiting for the first completed step to arrive..."}
                </Heading>
                <DSPyRunsScoresChart
                  dspyRuns={dspyRuns.data}
                  selectedPoint={selectedPoint}
                  setSelectedPoint={setSelectedPoint}
                  highlightedRun={highlightedRun}
                  selectedRuns={selectedRuns}
                  stepToDisplay={stepToDisplay}
                  labelNames={labelNames}
                />
              </VStack>
              <Box width="full" borderTop="1px solid" borderColor="gray.200">
                {stepToDisplay &&
                  (!highlightedRun ||
                    highlightedRun === stepToDisplay.run_id) && (
                    <RunDetails
                      project={project}
                      experiment={experiment}
                      dspyStepSummary={stepToDisplay}
                      workflowVersion={
                        runsById?.[stepToDisplay.run_id]?.workflow_version
                      }
                      size="sm"
                    />
                  )}
              </Box>
            </>
          )
        )}
      </VStack>
    </HStack>
  );
}
