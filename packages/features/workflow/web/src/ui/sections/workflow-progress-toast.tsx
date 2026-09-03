import { Alert, Button, HStack, Progress, Spacer, VStack } from "@chakra-ui/react";

import { useWorkflowStore } from "../../behavior/use-workflow-store";

/** Workflow progress overlay with process-specific execution actions supplied by the app. */
export function WorkflowProgressToast({
  renderEvaluationProgress,
  onStopEvaluation,
  onStopOptimization,
}: {
  renderEvaluationProgress: (
    state: NonNullable<ReturnType<typeof useWorkflowStore.getState>["state"]["evaluation"]>,
  ) => React.ReactNode;
  onStopEvaluation: (input: { runId: string }) => void;
  onStopOptimization: (input: { runId: string }) => void;
}) {
  const { evaluationState, optimizationState, setOpenResultsPanelRequest } = useWorkflowStore(
    ({ state, setOpenResultsPanelRequest }) => ({
      evaluationState: state.evaluation,
      optimizationState: state.optimization,
      setOpenResultsPanelRequest,
    }),
  );

  const isEvaluationRunning = evaluationState?.status === "running";
  const isOptimizationRunning = optimizationState?.status === "running";

  if (!isEvaluationRunning && !isOptimizationRunning) {
    return null;
  }

  return (
    <VStack gap={4}>
      {isEvaluationRunning && evaluationState && (
        <BaseProgressToast
          description="Running evaluation"
          progress={renderEvaluationProgress(evaluationState)}
          onClick={() => setOpenResultsPanelRequest("evaluations")}
          onCancel={() => onStopEvaluation({ runId: evaluationState.run_id ?? "" })}
        />
      )}
      {isOptimizationRunning && optimizationState && (
        <BaseProgressToast
          description="Running optimization"
          progress={<WorkflowOptimizationProgressBar />}
          onClick={() => setOpenResultsPanelRequest("optimizations")}
          onCancel={() => onStopOptimization({ runId: optimizationState.run_id ?? "" })}
        />
      )}
    </VStack>
  );
}

export function BaseProgressToast({
  description,
  progress,
  onClick,
  onCancel,
}: {
  description: string;
  progress: React.ReactNode;
  onClick: () => void;
  onCancel: () => void;
}) {
  return (
    <Alert.Root
      position="absolute"
      bottom="3"
      right="3"
      zIndex={100}
      width="fit-content"
      background="bg"
      padding={1}
      borderRadius="md"
      border="1px solid"
      borderColor="border"
      onClick={onClick}
      color="fg"
    >
      <VStack align="start" gap={1}>
        <VStack align="start" gap={1} paddingY={2} paddingX={3}>
          <HStack gap={2}>
            <Alert.Indicator />
            <Alert.Title>Please wait...</Alert.Title>
          </HStack>
          <HStack minWidth="300px">
            <Alert.Description fontSize="14px">{description}</Alert.Description>
            <Spacer />
            <Button
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onCancel();
              }}
            >
              Cancel
            </Button>
          </HStack>
        </VStack>
        {progress}
      </VStack>
    </Alert.Root>
  );
}

export function WorkflowOptimizationProgressBar({
  size = "xs",
}: {
  size?: "xs" | "sm" | "md" | "lg";
}) {
  return (
    <HStack width="full" gap={4}>
      <Progress.Root size={size} width="full" colorPalette="blue" value={null} animated striped>
        <Progress.Track borderRadius="sm">
          <Progress.Range />
        </Progress.Track>
      </Progress.Root>
    </HStack>
  );
}
