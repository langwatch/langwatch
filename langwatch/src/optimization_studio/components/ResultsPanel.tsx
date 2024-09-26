import {
  Alert,
  AlertIcon,
  Button,
  HStack,
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

export function ResultsPanel({
  collapsePanel,
}: {
  collapsePanel: (isCollapsed: boolean) => void;
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

  return <Text>Optimization results will go here</Text>;
}
