/**
 * BatchRunsSidebar - Sidebar component showing list of evaluation runs
 *
 * Modern design matching the prompt playground sidebar style:
 * - No borders on the sidebar itself
 * - Items have rounded corners that don't touch edges
 * - Two-line Apple Notes style layout
 * - formatTimeAgo for relative dates
 */
import {
  Alert,
  Box,
  HStack,
  Skeleton,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { WorkflowVersion } from "@prisma/client";

import { Tooltip } from "~/components/ui/tooltip";
import { FormatMoney } from "~/optimization_studio/components/FormatMoney";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { getColorForString } from "~/utils/rotatingColors";

/**
 * Summary data for a single evaluation run
 */
export type BatchRunSummary = {
  runId: string;
  workflowVersion?: Pick<WorkflowVersion, "id" | "version" | "commitMessage"> | null;
  timestamps: {
    created_at: number;
    finished_at?: number | null;
    stopped_at?: number | null;
  };
  progress?: number | null;
  total?: number | null;
  summary: {
    datasetCost?: number | null;
    evaluationsCost?: number | null;
    evaluations: Record<
      string,
      {
        name: string;
        averageScore?: number | null;
        averagePassed?: number | null;
      }
    >;
  };
};

type BatchRunsSidebarProps = {
  /** List of runs to display */
  runs: BatchRunSummary[];
  /** Currently selected run ID */
  selectedRunId?: string;
  /** Callback when a run is selected */
  onSelectRun: (runId: string) => void;
  /** Loading state */
  isLoading?: boolean;
  /** Error message */
  error?: string | null;
  /** Size variant */
  size?: "sm" | "md";
};

/**
 * Check if a run is finished
 */
const isRunFinished = (timestamps: BatchRunSummary["timestamps"]): boolean => {
  return !!(timestamps.finished_at ?? timestamps.stopped_at);
};

/**
 * Format evaluation summary for display
 */
const formatEvalSummary = (
  evaluation: { name: string; averageScore?: number | null; averagePassed?: number | null },
  compact: boolean = false
): string => {
  if (evaluation.averagePassed !== undefined && evaluation.averagePassed !== null) {
    const pct = Math.round(evaluation.averagePassed * 100);
    return compact ? `${pct}%` : `${pct}% passed`;
  }
  if (evaluation.averageScore !== undefined && evaluation.averageScore !== null) {
    const score = evaluation.averageScore.toFixed(2);
    return compact ? score : `avg ${score}`;
  }
  return "-";
};

export function BatchRunsSidebar({
  runs,
  selectedRunId,
  onSelectRun,
  isLoading,
  error,
  size = "md",
}: BatchRunsSidebarProps) {
  // Simple version badge component
  const VersionBadge = ({
    version,
    backgroundColor,
  }: {
    version?: Pick<WorkflowVersion, "version"> | null;
    backgroundColor?: string;
  }) => (
    <Box
      width="32px"
      height="32px"
      borderRadius="md"
      display="flex"
      alignItems="center"
      justifyContent="center"
      fontSize="11px"
      fontWeight="600"
      color="white"
      bg={
        backgroundColor ??
        (version?.version
          ? getColorForString("colors", version.version).color
          : "gray.400")
      }
      flexShrink={0}
    >
      {version?.version ? `v${version.version}` : ""}
    </Box>
  );

  return (
    <VStack
      align="stretch"
      paddingY={2}
      fontSize="14px"
      minWidth={size === "sm" ? "220px" : "260px"}
      maxWidth={size === "sm" ? "220px" : "260px"}
      height="full"
      gap={0}
      overflowY="auto"
    >
      {/* Loading state */}
      {isLoading && (
        <VStack gap={1} paddingX={2}>
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} width="100%" height="52px" borderRadius="md" />
          ))}
        </VStack>
      )}

      {/* Error state */}
      {error && (
        <Box paddingX={2}>
          <Alert.Root status="error">
            <Alert.Indicator />
            {error}
          </Alert.Root>
        </Box>
      )}

      {/* Empty state */}
      {!isLoading && !error && runs.length === 0 && (
        <Text paddingX={3} paddingY={4} color="gray.500" fontSize="sm">
          No runs yet
        </Text>
      )}

      {/* Run list - Apple Notes style */}
      <VStack gap={0.5} align="stretch" paddingX={2}>
        {!isLoading &&
          !error &&
          runs.map((run) => {
            const isSelected = selectedRunId === run.runId;
            const isFinished = isRunFinished(run.timestamps);
            const runCost =
              (run.summary.datasetCost ?? 0) + (run.summary.evaluationsCost ?? 0);
            
            // Build the name - prefer commit message, then just run ID
            const runName = run.workflowVersion?.commitMessage 
              ? run.workflowVersion.commitMessage
              : run.runId;

            // Build summary line: evaluator scores + cost (filter out "-" values)
            const summaryParts: string[] = [];
            Object.values(run.summary.evaluations)
              .slice(0, 2)
              .forEach((ev) => {
                const summary = formatEvalSummary(ev, true);
                if (summary !== "-") {
                  summaryParts.push(summary);
                }
              });

            return (
              <HStack
                key={run.runId}
                paddingX={2}
                paddingY={2}
                cursor="pointer"
                role="button"
                bg={isSelected ? "blue.50" : "transparent"}
                color={isSelected ? "blue.700" : "gray.700"}
                borderRadius="md"
                _hover={{
                  bg: isSelected ? "blue.100" : "gray.100",
                }}
                onClick={() => onSelectRun(run.runId)}
                gap={2}
                data-testid={`run-item-${run.runId}`}
              >
                {/* Version badge */}
                <VersionBadge
                  version={run.workflowVersion}
                  backgroundColor={
                    run.timestamps.stopped_at
                      ? "red.400"
                      : run.workflowVersion
                        ? undefined
                        : getColorForString("colors", run.runId).color
                  }
                />

                <VStack align="start" gap={0} flex={1} minWidth={0}>
                  {/* Line 1: Name + spinner if running */}
                  <HStack gap={1} width="100%">
                    <Tooltip content={runName} positioning={{ placement: "top" }} openDelay={500}>
                      <Text
                        fontSize="13px"
                        fontWeight="medium"
                        lineClamp={1}
                        wordBreak="break-all"
                        flex={1}
                      >
                        {runName}
                      </Text>
                    </Tooltip>
                    {!isFinished && (
                      <Spinner size="xs" color="blue.500" flexShrink={0} />
                    )}
                  </HStack>

                  {/* Line 2: Time ago + summary stats */}
                  <HStack
                    color="gray.500"
                    fontSize="12px"
                    gap={1}
                    width="100%"
                  >
                    {/* Time ago */}
                    <Text whiteSpace="nowrap" flexShrink={0}>
                      {run.timestamps.created_at
                        ? formatTimeAgo(run.timestamps.created_at)
                        : "..."}
                    </Text>
                    
                    {/* Summary stats - only show separator if there's content */}
                    {summaryParts.length > 0 && (
                      <>
                        <Text>·</Text>
                        <Text lineClamp={1}>{summaryParts.join(" · ")}</Text>
                      </>
                    )}
                    {runCost > 0 && (
                      <>
                        {summaryParts.length > 0 && <Text>·</Text>}
                        {summaryParts.length === 0 && <Text>·</Text>}
                        <Text whiteSpace="nowrap">
                          <FormatMoney
                            amount={runCost}
                            currency="USD"
                            format="$0.00[0]"
                          />
                        </Text>
                      </>
                    )}

                    {/* Stopped indicator */}
                    {run.timestamps.stopped_at && (
                      <Tooltip content="Run was stopped" positioning={{ placement: "top" }}>
                        <Box
                          width="6px"
                          height="6px"
                          background="red.400"
                          borderRadius="full"
                          flexShrink={0}
                        />
                      </Tooltip>
                    )}
                  </HStack>
                </VStack>
              </HStack>
            );
          })}
      </VStack>
    </VStack>
  );
}
