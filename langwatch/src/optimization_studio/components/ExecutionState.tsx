import { Box, Button, HStack, Spinner, Text } from "@chakra-ui/react";
import { useWorkflowExecution } from "../hooks/useWorkflowExecution";
import { useWorkflowStore } from "../hooks/useWorkflowStore";

export function RunningStatus({ isLoading }: { isLoading?: boolean }) {
  const { executionState } = useWorkflowStore(({ state }) => ({
    executionState: state.execution,
  }));

  const { stopWorkflowExecution } = useWorkflowExecution();

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
          <Button
            size="xs"
            onClick={() =>
              stopWorkflowExecution({
                trace_id: executionState?.trace_id ?? "",
              })
            }
          >
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
