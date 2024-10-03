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
  useToast,
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
import {
  EvaluationProgressBar,
  OptimizationProgressBar,
} from "./ProgressToast";
import {
  DSPyExperimentRunList,
  DSPyExperimentSummary,
  DSPyRunsScoresChart,
  RunDetails,
  useDSPyExperimentState,
} from "../../components/experiments/DSPyExperiment";
import type { Experiment, Project } from "@prisma/client";
import { useOptimizationExecution } from "../hooks/useOptimizationExecution";
import type { AppliedOptimization } from "../../server/experiments/types";
import type { Signature } from "../types/dsl";
import type { Node } from "@xyflow/react";

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
  const { optimizationState, nodes, setNodes, setOpenResultsPanelRequest } =
    useWorkflowStore(
      ({ state, nodes, setNodes, setOpenResultsPanelRequest }) => ({
        optimizationState: state.optimization,
        nodes,
        setNodes,
        setOpenResultsPanelRequest,
      })
    );

  const [selectedRuns, setSelectedRuns] = useState<string[]>(
    optimizationState?.run_id ? [optimizationState.run_id] : []
  );

  const {
    dspyRuns,
    selectedRuns: selectedRuns_,
    setSelectedRuns: setSelectedRuns_,
    highlightedRun,
    setHighlightedRun,
    selectedPoint,
    setSelectedPoint,
    dspyRunsPlusIncoming,
    stepToDisplay,
    labelNames,
    runsById,
    optimizerNames,
  } = useDSPyExperimentState({
    project,
    experiment,
    selectedRuns,
    setSelectedRuns,
  });

  const { stopOptimizationExecution } = useOptimizationExecution();

  const optimizationStateRunId = optimizationState?.run_id;

  const toast = useToast();

  const onApplyOptimizations = (
    appliedOptimizations: AppliedOptimization[]
  ) => {
    const appliedOptimizationsMap = Object.fromEntries(
      appliedOptimizations.map((optimization) => [
        optimization.id,
        optimization,
      ])
    );
    const matchingNodes = nodes.filter(
      (node) => appliedOptimizationsMap[node.id]
    );

    setNodes(
      nodes.map((node) => {
        const optimization = appliedOptimizationsMap[node.id];
        if (node.type === "signature" && optimization) {
          const node_ = {
            ...node,
            // deep clone the node data
            data: JSON.parse(JSON.stringify(node.data)),
          } as Node<Signature>;
          if (optimization.demonstrations) {
            node_.data.demonstrations = optimization.demonstrations;
          }
          if (optimization.prompt) {
            node_.data.prompt = optimization.prompt;
          }
          const optimizedFieldsByIdentifier = Object.fromEntries(
            optimization.fields?.map((field) => [field.identifier, field]) ?? []
          );
          node_.data.inputs = node_.data.inputs?.map((input) => {
            const optimizedField =
              optimizedFieldsByIdentifier[input.identifier];
            if (optimizedField && optimizedField.field_type === "input") {
              return {
                ...input,
                ...optimizedField,
              };
            }
            return input;
          });
          node_.data.outputs = node_.data.outputs?.map((output) => {
            const optimizedField =
              optimizedFieldsByIdentifier[output.identifier];
            if (optimizedField && optimizedField.field_type === "output") {
              return {
                ...output,
                ...optimizedField,
              };
            }
            return output;
          });
          return node_;
        }
        return node;
      })
    );

    setOpenResultsPanelRequest("closed");
    toast({
      title: "Optimizations Applied!",
      description: `${matchingNodes.length} ${
        matchingNodes.length === 1 ? "component was" : "components were"
      } updated.`,
      status: "success",
      duration: 5000,
      isClosable: true,
    });
  };

  return (
    <HStack align="start" width="full" height="full" spacing={0}>
      <DSPyExperimentRunList
        dspyRuns={dspyRuns}
        selectedRuns={selectedRuns_}
        setSelectedRuns={setSelectedRuns_}
        setHighlightedRun={setHighlightedRun}
        dspyRunsPlusIncoming={dspyRunsPlusIncoming}
        size="sm"
      />
      <VStack align="start" width="full" height="full" spacing={0}>
        <VStack width="full" height="full" overflowY="auto">
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
                    selectedRuns={selectedRuns_}
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
        <Spacer />
        {runsById && selectedRuns_.length === 1 && (
          <DSPyExperimentSummary
            project={project}
            experiment={experiment}
            run={runsById[selectedRuns_[0]!]}
            onApply={onApplyOptimizations}
          />
        )}
        {(selectedRuns.length === 0 ||
          selectedRuns.includes(optimizationStateRunId ?? "")) &&
          optimizationStateRunId &&
          optimizationState?.status === "running" && (
            <HStack
              width="full"
              padding={3}
              borderTop="1px solid"
              borderColor="gray.200"
            >
              <Text whiteSpace="nowrap" marginTop="-1px" paddingX={2}>
                Running
              </Text>
              <OptimizationProgressBar size="lg" />
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  stopOptimizationExecution({
                    run_id: optimizationStateRunId,
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
