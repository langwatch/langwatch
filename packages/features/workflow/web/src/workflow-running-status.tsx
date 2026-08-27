import { Box, Button, HStack, Spinner, Text } from "@chakra-ui/react";

import { useWorkflowStore } from "./hooks/use-workflow-store";

/** Workflow execution status with the process-owned stop action supplied by the app. */
export function WorkflowRunningStatus({
  isLoading,
  onStop,
}: {
  isLoading?: boolean;
  onStop: (input: { traceId: string }) => void;
}) {
  const { executionState } = useWorkflowStore(({ state }) => ({
    executionState: state.execution,
  }));
  const isRunning = executionState?.status === "running";
  const isWaiting = executionState?.status === "waiting";

  if (!isRunning && !isWaiting && !isLoading) {
    return null;
  }

  return (
    <Box paddingLeft={2}>
      {isRunning || isLoading ? (
        <HStack>
          <Spinner size="xs" />
          <Text fontSize="13px">Running...</Text>
          <Button size="xs" onClick={() => onStop({ traceId: executionState?.trace_id ?? "" })}>
            Stop
          </Button>
        </HStack>
      ) : isWaiting ? (
        <HStack>
          <Spinner size="xs" />
          <Text fontSize="13px">Waiting for runtime...</Text>
        </HStack>
      ) : null}
    </Box>
  );
}
