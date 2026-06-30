/**
 * ADR-034: the live dataset-processing bar — percent (input bytes), a running
 * row count, a client-computed ETA, and a phase stepper. Renders nothing once
 * the dataset is ready (the editor takes over) and an actionable failed state
 * with Retry. The terminal authority is the caller's `getById`; this component
 * just reflects the view the hook derives.
 */
import {
  Alert,
  Box,
  Button,
  HStack,
  Progress,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type {
  DatasetProgressPhase,
  DatasetStatusLike,
} from "./datasetProgressView";
import { useDatasetProcessingProgress } from "./useDatasetProcessingProgress";

const PHASES: { key: DatasetProgressPhase; label: string }[] = [
  { key: "uploading", label: "Uploading" },
  { key: "processing", label: "Processing" },
  { key: "finalizing", label: "Finalizing" },
  { key: "ready", label: "Ready" },
];

const formatEta = (seconds?: number): string | null => {
  if (seconds == null) return null;
  if (seconds < 60) return `~${seconds}s left`;
  return `~${Math.round(seconds / 60)} min left`;
};

function PhaseStepper({ current }: { current: DatasetProgressPhase }) {
  const activeIdx = PHASES.findIndex((p) => p.key === current);
  return (
    <HStack gap={1} flexShrink={0}>
      {PHASES.map((p, i) => (
        <HStack key={p.key} gap={1}>
          <Text
            textStyle="xs"
            color={i <= activeIdx ? "fg" : "fg.subtle"}
            fontWeight={i === activeIdx ? "semibold" : "normal"}
          >
            {p.label}
          </Text>
          {i < PHASES.length - 1 && (
            <Text textStyle="xs" color="fg.subtle">
              →
            </Text>
          )}
        </HStack>
      ))}
    </HStack>
  );
}

export function DatasetProcessingProgress(props: {
  projectId: string;
  datasetId: string;
  status: DatasetStatusLike;
  statusError?: string | null;
  onReconcile?: () => void;
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  const view = useDatasetProcessingProgress(props);

  if (view.kind === "hidden") return null;

  if (view.kind === "failed") {
    return (
      <Alert.Root status="error" data-testid="dataset-processing-failed">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>We could not prepare your dataset</Alert.Title>
          <Alert.Description>
            {view.message ??
              "Something went wrong while processing your file. You can retry."}
          </Alert.Description>
        </Alert.Content>
        {props.onRetry && (
          <Button
            size="sm"
            colorPalette="red"
            variant="outline"
            loading={props.isRetrying}
            onClick={props.onRetry}
          >
            Retry
          </Button>
        )}
      </Alert.Root>
    );
  }

  const indeterminate = view.kind === "indeterminate";
  const eta = indeterminate ? null : formatEta(view.etaSeconds);

  return (
    <Box
      padding={3}
      borderRadius="lg"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.panel"
      data-testid="dataset-processing-progress"
    >
      <VStack align="stretch" gap={2}>
        <HStack justify="space-between" gap={3}>
          <HStack gap={2} minWidth={0}>
            <Spinner size="xs" color="fg.muted" />
            <Text textStyle="sm" color="fg" truncate>
              {indeterminate ? (
                "Preparing your dataset…"
              ) : (
                <>
                  {view.percent}% prepared
                  {view.rows != null
                    ? ` · ${view.rows.toLocaleString()} rows`
                    : ""}
                  {eta ? ` · ${eta}` : ""}
                </>
              )}
            </Text>
          </HStack>
          <PhaseStepper current={view.phase} />
        </HStack>
        <Progress.Root
          value={indeterminate ? null : view.percent}
          colorPalette="blue"
          size="xs"
        >
          <Progress.Track>
            <Progress.Range css={{ transition: "width 0.5s ease-in-out" }} />
          </Progress.Track>
        </Progress.Root>
      </VStack>
    </Box>
  );
}
