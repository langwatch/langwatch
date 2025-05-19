import {
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
  type BoxProps,
} from "@chakra-ui/react";
import numeral from "numeral";
import { useDebounceValue } from "usehooks-ts";
import { RenderInputOutput } from "~/components/traces/RenderInputOutput";
import { SpanDuration } from "~/components/traces/SpanDetails";
import { useDrawer } from "~/components/CurrentDrawer";
import { RedactedField } from "~/components/ui/RedactedField";
import type { ExecutionState } from "~/optimization_studio/types/dsl";

interface OutputPanelProps {
  executionState?: ExecutionState;
  isTracingEnabled?: boolean;
  nodeType?: string;
}

/**
 * Panel that displays execution outputs, status, costs, and timing information
 * for workflow nodes and prompt configurations.
 */
export const ExecutionOutputPanel = ({
  executionState,
  isTracingEnabled = false,
  nodeType,
}: OutputPanelProps) => {
  const [isWaitingLong] = useDebounceValue(
    executionState?.status === "waiting",
    600
  );

  const isExecutionComplete =
    executionState?.status === "success" || executionState?.status === "error";

  return (
    <VStack align="start" gap={3}>
      <HStack align="center" width="full" paddingBottom={3}>
        <Heading
          as="h3"
          fontSize="16px"
          fontWeight="bold"
          textTransform="uppercase"
          color="gray.600"
          paddingBottom={4}
        >
          Outputs
        </Heading>
        <Spacer />
        {executionState &&
          executionState?.timestamps &&
          isExecutionComplete && (
            <ExecutionMetadata
              executionState={executionState}
              isTracingEnabled={isTracingEnabled}
            />
          )}
      </HStack>

      {renderExecutionContent(executionState, isWaitingLong, nodeType)}
    </VStack>
  );
};

/**
 * Displays execution metadata like cost, duration, and trace links
 */
const ExecutionMetadata = ({
  executionState,
  isTracingEnabled,
}: {
  executionState: ExecutionState;
  isTracingEnabled: boolean;
}) => {
  const { openDrawer } = useDrawer();
  const hasTiming =
    executionState.timestamps?.started_at &&
    executionState.timestamps?.finished_at;

  return (
    <HStack gap={3}>
      {executionState.cost !== undefined && (
        <Text color="gray.500">
          {numeral(executionState.cost).format("$0.00[000]a")}
        </Text>
      )}

      {hasTiming && (
        <>
          {executionState.cost !== undefined && <Text color="gray.400">·</Text>}
          <SpanDuration
            span={{
              error:
                executionState?.status === "error"
                  ? executionState.error
                  : undefined,
              timestamps: {
                started_at: executionState.timestamps?.started_at ?? 0,
                finished_at: executionState.timestamps?.finished_at ?? 0,
              },
            }}
          />
        </>
      )}

      {isTracingEnabled && executionState?.trace_id && (
        <>
          <Text color="gray.400">·</Text>
          <Button
            size="sm"
            onClick={() => {
              openDrawer("traceDetails", {
                traceId: executionState.trace_id ?? "",
              });
            }}
          >
            Full Trace
          </Button>
        </>
      )}
    </HStack>
  );
};

/**
 * Renders the appropriate content based on execution state
 */
const renderExecutionContent = (
  executionState?: ExecutionState,
  isWaitingLong?: boolean,
  nodeType?: string
) => {
  if (!executionState) {
    return <Text color="gray.500">Waiting for execution</Text>;
  }

  return (
    <>
      {renderExecutionStatus(executionState, isWaitingLong)}
      {renderExecutionError(executionState)}
      {renderExecutionOutputs(executionState, nodeType)}
    </>
  );
};

/**
 * Renders the current execution status messages
 */
const renderExecutionStatus = (
  executionState: ExecutionState,
  isWaitingLong?: boolean
) => {
  if (isWaitingLong && executionState.status === "waiting") {
    return <Text>Waiting for runner</Text>;
  }

  if (
    (!isWaitingLong && executionState.status === "waiting") ||
    executionState.status === "running"
  ) {
    return <Text>Running...</Text>;
  }

  return null;
};

/**
 * Renders error information if execution failed
 */
const renderExecutionError = (executionState: ExecutionState) => {
  if (executionState.status !== "error") return null;

  return (
    <VStack width="full" align="start" gap={3}>
      <Text
        fontSize="13px"
        fontWeight="bold"
        textTransform="uppercase"
        color="gray.600"
      >
        Error
      </Text>
      <OutputBox
        color="red.700"
        value={executionState.error ?? "No error message captured"}
      />
    </VStack>
  );
};

/**
 * Renders successful execution outputs
 */
const renderExecutionOutputs = (
  executionState: ExecutionState,
  nodeType?: string
) => {
  if (executionState.status !== "success" || !executionState.outputs) {
    return null;
  }

  return Object.entries(executionState.outputs)
    .filter(([_, value]) => value !== null)
    .map(([identifier, value]) => {
      const isFail =
        (nodeType === "evaluator" &&
          identifier === "passed" &&
          value === false) ||
        (identifier === "status" && value === "error");
      const isSkipped =
        nodeType === "evaluator" &&
        identifier === "status" &&
        value === "skipped";
      const isSuccess =
        nodeType === "evaluator" && identifier === "passed" && value === true;

      const textColor = isSkipped
        ? "yellow.600"
        : isFail
        ? "red.600"
        : isSuccess
        ? "green.600"
        : "gray.600";

      return (
        <VStack
          width="full"
          align="start"
          key={identifier}
          gap={3}
          color={
            isSkipped
              ? "yellow.600"
              : isFail
              ? "red.600"
              : isSuccess
              ? "green.600"
              : undefined
          }
        >
          <Text
            fontSize="13px"
            fontWeight="bold"
            textTransform="uppercase"
            color={textColor}
          >
            {identifier}
          </Text>
          <OutputBox value={value} />
        </VStack>
      );
    });
};

/**
 * Renders a formatted output box with proper styling
 */
const OutputBox = ({ value, ...props }: { value: any } & BoxProps) => {
  return (
    <Box
      as="pre"
      borderRadius="6px"
      padding={4}
      borderWidth="1px"
      borderColor="gray.300"
      width="full"
      whiteSpace="pre-wrap"
      {...props}
    >
      <RedactedField field="output">
        <RenderInputOutput value={value} showTools />
      </RedactedField>
    </Box>
  );
};
