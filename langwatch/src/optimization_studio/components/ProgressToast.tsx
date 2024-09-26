import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  HStack,
  Progress,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { useEvaluationExecution } from "../hooks/useEvaluationExecution";

export function ProgressToast() {
  return <EvaluationProgressToast />;
}

export function EvaluationProgressToast() {
  const { workflowId, getWorkflow, evaluationState } = useWorkflowStore(
    ({ workflow_id: workflowId, getWorkflow, state }) => ({
      workflowId,
      getWorkflow,
      evaluationState: state.evaluation,
    })
  );

  const { stopEvaluationExecution } = useEvaluationExecution();

  const isRunning = evaluationState?.status === "running";

  if (!isRunning) {
    return null;
  }

  return (
    <BaseProgressToast
      description="Running evaluation"
      progress={<EvaluationProgressBar />}
      onCancel={() => {
        stopEvaluationExecution({
          run_id: evaluationState?.run_id ?? "",
        });
      }}
    />
  );
}

export function BaseProgressToast({
  description,
  progress,
}: {
  description: string;
  progress: React.ReactNode;
}) {
  return (
    <Alert
      status="info"
      position="absolute"
      bottom="3"
      right="3"
      zIndex={100}
      width="fit-content"
      background="white"
      padding={1}
      borderRadius="md"
      border="1px solid"
      borderColor="gray.200"
    >
      <VStack align="start" spacing={1}>
        <VStack align="start" spacing={1} paddingY={2} paddingX={3}>
          <HStack spacing={0}>
            <AlertIcon />
            <AlertTitle>Please wait...</AlertTitle>
          </HStack>
          <HStack minWidth="300px">
            <AlertDescription fontSize="14px">{description}</AlertDescription>
            <Spacer />
            <Button size="sm">Cancel</Button>
          </HStack>
        </VStack>
        {progress}
      </VStack>
    </Alert>
  );
}

export function EvaluationProgressBar() {
  const { evaluationState } = useWorkflowStore(({ state }) => ({
    evaluationState: state.evaluation,
  }));

  return <Progress size="xs" width="full" isIndeterminate />;
}
