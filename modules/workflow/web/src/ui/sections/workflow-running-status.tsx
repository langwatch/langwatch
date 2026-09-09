import { Box, Button, HStack, Spinner, Text } from "@chakra-ui/react";

import { useWorkflowStore } from "../../behavior/use-workflow-store.ts";

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

  if (isRunning || isLoading) {
    return (
      <Box paddingLeft={2}>
        <HStack>
          <Spinner size="xs" />
          <Text fontSize="13px">Running...</Text>
          <Button size="xs" onClick={() => onStop({ traceId: executionState?.trace_id ?? "" })}>
            Stop
          </Button>
        </HStack>
      </Box>
    );
  }

  return (
    <Box paddingLeft={2}>
      {isWaiting ? (
        <HStack>
          <Spinner size="xs" />
          <Text fontSize="13px">Waiting for runtime...</Text>
        </HStack>
      ) : null}
    </Box>
  );
}
