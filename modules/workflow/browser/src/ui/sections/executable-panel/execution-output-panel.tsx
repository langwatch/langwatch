import { useDrawer } from "@langwatch/browser-host/drawer";
import { CodePreview } from "@langwatch/design-system/code-preview";
import {
  Alert,
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import type { ExecutionState } from "@langwatch/workflow-contract";
import { CircleAlert } from "lucide-react";
import numeral from "numeral";
import { useDebounceValue } from "usehooks-ts";
import { z } from "zod";

import { RenderInputOutput } from "../../../behavior/lent-trace.tsx";
import { SpanDuration } from "../../elements/span-duration.tsx";
import { RedactedField } from "../redacted-field.tsx";

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
  const [isWaitingLong] = useDebounceValue(executionState?.status === "waiting", 600);

  const isExecutionComplete =
    executionState?.status === "success" || executionState?.status === "error";

  return (
    <VStack align="start" gap={3}>
      <HStack align="start" width="full" flexWrap="wrap" gap={2}>
        <Heading as="h3" textStyle="md" fontWeight="semibold" color="fg.muted">
          Outputs
        </Heading>
        <Spacer />
        {executionState?.timestamps && isExecutionComplete && (
          <ExecutionMetadata executionState={executionState} isTracingEnabled={isTracingEnabled} />
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
  const hasTiming = executionState.timestamps?.started_at && executionState.timestamps?.finished_at;

  return (
    <HStack gap={2} flexWrap="wrap" textStyle="xs">
      {executionState.cost !== undefined && (
        <Text color="fg.muted">{numeral(executionState.cost).format("$0.00[000]a")}</Text>
      )}

      {hasTiming && (
        <>
          {executionState.cost !== undefined && <Text color="fg.subtle">·</Text>}
          <SpanDuration
            span={{
              error: executionState?.status === "error" ? executionState.error : undefined,
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
          <Text color="fg.subtle">·</Text>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              openDrawer("traceV2Details", {
                traceId: executionState.trace_id ?? "",
              });
            }}
          >
            Full trace
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
  nodeType?: string,
) => {
  if (!executionState) {
    return <Text color="fg.muted">Waiting for execution</Text>;
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
const renderExecutionStatus = (executionState: ExecutionState, isWaitingLong?: boolean) => {
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
const runErrorDetails = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  message: z.string().optional(),
});

const renderExecutionError = (executionState: ExecutionState) => {
  if (executionState.status !== "error") return null;

  const details = executionState.error || "No error message captured";
  const json = formattedJson(details);
  const parsed = json ? runErrorDetails.safeParse(JSON.parse(json)) : null;
  const structured = parsed?.success ? parsed.data : void 0;
  const summary =
    structured?.message || details.trim().split("\n").filter(Boolean).at(-1) || details;
  const exception = /^([\w.]+(?:Error|Exception)):\s*(.*)$/.exec(summary);
  const title =
    structured?.type ||
    structured?.name ||
    exception?.[1] ||
    executionState.error_type ||
    "Execution failed";
  const message = exception?.[2] || summary;

  return (
    <VStack width="full" align="stretch" gap={3} minWidth={0}>
      <RedactedField field="output">
        <Alert.Root role="alert" status="error" size="sm">
          <Alert.Indicator>
            <CircleAlert />
          </Alert.Indicator>
          <Alert.Content>
            <Alert.Title>{title}</Alert.Title>
            <Alert.Description>{message}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
        <CodePreview
          code={json ?? details}
          language={json ? "json" : "python"}
          filename={json ? "Error details · JSON" : "Error details"}
          maxHeight="320px"
          compact
        />
      </RedactedField>
    </VStack>
  );
};

function outputTextColor({
  isSkipped,
  isFail,
  isSuccess,
}: {
  isSkipped: boolean;
  isFail: boolean;
  isSuccess: boolean;
}): string {
  if (isSkipped) return "yellow.fg";
  if (isFail) return "red.fg";
  if (isSuccess) return "green.fg";
  return "fg.muted";
}

/**
 * Renders successful execution outputs
 */
const renderExecutionOutputs = (executionState: ExecutionState, nodeType?: string) => {
  if (executionState.status !== "success" || !executionState.outputs) {
    return null;
  }

  // If/Else emits both branch handles (`true` and `false`) so the canvas
  // can route either way, but showing both as separate boxes reads as a
  // contradiction ("FALSE: true"). The condition result is just the `true`
  // handle's boolean, so surface that single value.
  if (nodeType === "if_else") {
    const outputs = executionState.outputs as Record<string, unknown>;
    const isConditionTrue = "true" in outputs ? outputs.true : !(outputs.false as boolean);
    return (
      <VStack width="full" align="start" gap={3}>
        <Text textStyle="sm" fontWeight="medium" color="fg.muted">
          Condition
        </Text>
        <OutputBox value={isConditionTrue} />
      </VStack>
    );
  }

  return Object.entries(executionState.outputs)
    .filter(([, value]) => value !== null)
    .map(([identifier, value]) => {
      const isFail =
        (nodeType === "evaluator" && identifier === "passed" && value === false) ||
        (identifier === "status" && value === "error");
      const isSkipped = nodeType === "evaluator" && identifier === "status" && value === "skipped";
      const isSuccess = nodeType === "evaluator" && identifier === "passed" && value === true;

      const hasTone = isSkipped || isFail || isSuccess;
      const textColor = outputTextColor({ isSkipped, isFail, isSuccess });

      return (
        <VStack
          width="full"
          align="start"
          key={identifier}
          gap={3}
          color={hasTone ? textColor : undefined}
        >
          <Text textStyle="sm" fontWeight="medium" color={textColor}>
            {identifier}
          </Text>
          <OutputBox value={value} />
        </VStack>
      );
    });
};

/** Structured outputs, including JSON strings, share the studio's code view. */
function formattedJson(value: unknown): string | undefined {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (parsed !== null && typeof parsed === "object") return JSON.stringify(parsed, null, 2);
  } catch {
    // Text and multimodal outputs keep their existing renderer.
  }
  return void 0;
}

const OutputBox = ({ value }: { value: unknown }) => {
  const json = formattedJson(value);
  return (
    <Box width="full" minWidth={0} textStyle="sm">
      <RedactedField field="output">
        {json ? (
          <CodePreview code={json} language="json" filename="JSON" maxHeight="320px" compact />
        ) : (
          <Box
            borderRadius="lg"
            padding={3}
            borderWidth="1px"
            borderColor="border"
            maxHeight="320px"
            overflow="auto"
          >
            <RenderInputOutput value={value} showTools />
          </Box>
        )}
      </RedactedField>
    </Box>
  );
};
