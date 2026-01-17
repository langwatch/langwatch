import { Box, Button, HStack, Spinner, Text } from "@chakra-ui/react";
import { LuPlay, LuSquare } from "react-icons/lu";
import type { ExecutionScope } from "~/server/evaluations-v3/execution/types";
import { useExecuteEvaluation } from "../hooks/useExecuteEvaluation";

type ExecutionControlsProps = {
  /** Whether the evaluation is ready to run (all mappings configured) */
  isReady?: boolean;
  /** Custom execution scope (defaults to full) */
  scope?: ExecutionScope;
  /** Compact mode for smaller displays */
  compact?: boolean;
  /** Callback when execution completes */
  onComplete?: () => void;
};

/**
 * ExecutionControls - Run/Stop button with progress indicator.
 *
 * Displays:
 * - "Evaluate" button when idle
 * - "Stop" button with progress when running
 * - Completion state after execution
 */
export function ExecutionControls({
  isReady = true,
  scope,
  compact = false,
  onComplete,
}: ExecutionControlsProps) {
  const { status, progress, execute, abort } = useExecuteEvaluation();

  const isRunning = status === "running";
  const isIdle = status === "idle";
  const hasProgress = progress.total > 0;
  const progressPercent = hasProgress
    ? (progress.completed / progress.total) * 100
    : 0;

  const handleClick = async () => {
    if (isRunning) {
      await abort();
    } else {
      await execute(scope);
      onComplete?.();
    }
  };

  // Determine button color
  const buttonColor = isRunning ? "red" : "green";

  return (
    <HStack gap={3}>
      <Button
        colorPalette={buttonColor}
        size={compact ? "sm" : "md"}
        onClick={handleClick}
        disabled={!isReady && isIdle}
        minWidth={compact ? "100px" : "120px"}
        data-testid="execution-control-button"
      >
        {isRunning ? (
          <>
            <LuSquare />
            <Text>Stop</Text>
          </>
        ) : (
          <>
            <LuPlay />
            <Text>Evaluate</Text>
          </>
        )}
      </Button>

      {/* Progress indicator */}
      {isRunning && hasProgress && (
        <HStack gap={2} minWidth="120px">
          <Spinner size="sm" color="blue.500" />
          <Text fontSize="sm" color="gray.600" whiteSpace="nowrap">
            {progress.completed}/{progress.total}
          </Text>
          {!compact && (
            <Box
              width="80px"
              height="4px"
              bg="gray.200"
              borderRadius="full"
              overflow="hidden"
            >
              <Box
                height="100%"
                bg="blue.500"
                width={`${progressPercent}%`}
                transition="width 0.3s ease"
              />
            </Box>
          )}
        </HStack>
      )}

      {/* Completion indicator */}
      {!isRunning && status === "completed" && hasProgress && (
        <Text fontSize="sm" color="green.600" fontWeight="medium">
          ✓ {progress.completed}/{progress.total} completed
        </Text>
      )}

      {/* Error indicator */}
      {!isRunning && status === "error" && (
        <Text fontSize="sm" color="red.600" fontWeight="medium">
          ⚠ Execution failed
        </Text>
      )}

      {/* Stopped indicator */}
      {!isRunning && status === "stopped" && hasProgress && (
        <Text fontSize="sm" color="orange.600" fontWeight="medium">
          ⏹ Stopped at {progress.completed}/{progress.total}
        </Text>
      )}
    </HStack>
  );
}

/**
 * Minimal run button for row/cell level execution.
 */
export function MiniRunButton({
  onClick,
  isRunning,
  disabled,
  testId,
}: {
  onClick: () => void;
  isRunning?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <Button
      size="xs"
      variant="ghost"
      colorPalette={isRunning ? "red" : "gray"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      padding={1}
      minWidth="auto"
      height="auto"
      data-testid={testId}
    >
      {isRunning ? <Spinner size="xs" /> : <LuPlay size={14} />}
    </Button>
  );
}
