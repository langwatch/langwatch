import {
  Alert,
  AlertIcon,
  Button,
  HStack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { api } from "../../utils/api";
import {
  BatchEvaluationV2EvaluationResults,
  BatchEvaluationV2RunList,
  useBatchEvaluationState,
} from "../../components/experiments/BatchEvaluationV2";
import { experimentSlugify } from "../../server/experiments/utils";
import { useState } from "react";
import { X } from "react-feather";

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
        <TabPanels minHeight="0">
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
  const { workflowId } = useWorkflowStore(({ workflow_id: workflowId }) => ({
    workflowId,
  }));

  const { project } = useOrganizationTeamProject();

  const experiment = api.experiments.getExperimentBySlug.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: experimentSlugify(workflowId ?? ""),
    },
    {
      enabled: !!project && !!workflowId,
    }
  );

  const [selectedRunId, setSelectedRunId] = useState<string>();

  const { selectedRun, isFinished, batchEvaluationRuns } =
    useBatchEvaluationState({
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

  return (
    <HStack align="start" width="full" height="full" spacing={0}>
      <BatchEvaluationV2RunList
        batchEvaluationRuns={batchEvaluationRuns}
        selectedRun={selectedRun}
        setSelectedRunId={setSelectedRunId}
        size="sm"
      />
      {selectedRun && (
        <BatchEvaluationV2EvaluationResults
          project={project}
          experiment={experiment.data}
          runId={selectedRun.run_id}
          isFinished={isFinished}
          size="sm"
        />
      )}
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
