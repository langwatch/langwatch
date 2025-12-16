/**
 * History Panel
 *
 * Shows past evaluation runs with their results.
 */

import {
  Badge,
  Box,
  Button,
  HStack,
  IconButton,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuChevronRight, LuClock, LuX } from "react-icons/lu";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { api } from "../../../../utils/api";
import { formatDistanceToNow } from "date-fns";

type Props = {
  onClose: () => void;
};

export function HistoryPanel({ onClose }: Props) {
  const { project } = useOrganizationTeamProject();
  const { experimentId, selectedRunId, selectRun } = useEvaluationV3Store(
    useShallow((s) => ({
      experimentId: s.experimentId,
      selectedRunId: s.selectedRunId,
      selectRun: s.selectRun,
    }))
  );

  // Fetch evaluation runs for this experiment
  const runs = api.experiments.getExperimentBatchEvaluationRuns.useQuery(
    {
      projectId: project?.id ?? "",
      experimentId: experimentId ?? "",
    },
    {
      enabled: !!project && !!experimentId,
      refetchInterval: 5000, // Refresh every 5 seconds
    }
  );

  return (
    <VStack
      width="300px"
      height="full"
      background="white"
      borderLeft="1px solid"
      borderColor="gray.200"
      gap={0}
    >
      {/* Header */}
      <HStack
        width="full"
        paddingX={3}
        paddingY={2}
        borderBottom="1px solid"
        borderColor="gray.200"
        justify="space-between"
      >
        <HStack gap={2}>
          <LuClock size={16} />
          <Text fontSize="sm" fontWeight="medium">
            Run History
          </Text>
        </HStack>
        <IconButton
          aria-label="Close history"
          variant="ghost"
          size="xs"
          onClick={onClose}
        >
          <LuX size={14} />
        </IconButton>
      </HStack>

      {/* Runs List */}
      <VStack
        width="full"
        flex={1}
        overflowY="auto"
        padding={2}
        gap={1}
        align="stretch"
      >
        {runs.isLoading && (
          <>
            <Skeleton height="60px" borderRadius="md" />
            <Skeleton height="60px" borderRadius="md" />
            <Skeleton height="60px" borderRadius="md" />
          </>
        )}

        {runs.data?.runs.length === 0 && (
          <Text
            color="gray.500"
            fontSize="sm"
            textAlign="center"
            paddingY={8}
          >
            No evaluation runs yet.
            <br />
            Click Evaluate to run your first evaluation.
          </Text>
        )}

        {runs.data?.runs.map((run) => {
          const isSelected = selectedRunId === run.run_id;
          const isFinished = !!run.timestamps.finished_at;
          const isStopped = !!run.timestamps.stopped_at;

          // Calculate average score from evaluations
          const avgScore =
            Object.values(run.summary.evaluations ?? {}).reduce(
              (sum, ev) => sum + (ev.average_score ?? 0),
              0
            ) / Math.max(Object.keys(run.summary.evaluations ?? {}).length, 1);

          // Calculate pass rate
          const evaluationsWithPassed = Object.values(
            run.summary.evaluations ?? {}
          ).filter((ev) => ev.average_passed !== undefined);
          const avgPassRate =
            evaluationsWithPassed.length > 0
              ? evaluationsWithPassed.reduce(
                  (sum, ev) => sum + (ev.average_passed ?? 0),
                  0
                ) / evaluationsWithPassed.length
              : undefined;

          return (
            <Box
              key={run.run_id}
              padding={3}
              borderRadius="md"
              border="1px solid"
              borderColor={isSelected ? "blue.300" : "gray.200"}
              background={isSelected ? "blue.50" : "white"}
              cursor="pointer"
              onClick={() => selectRun(run.run_id)}
              _hover={{
                borderColor: isSelected ? "blue.400" : "gray.300",
                background: isSelected ? "blue.50" : "gray.50",
              }}
              transition="all 0.1s"
            >
              <VStack align="stretch" gap={2}>
                <HStack justify="space-between">
                  <Text fontSize="xs" color="gray.500">
                    {formatDistanceToNow(run.timestamps.created_at, {
                      addSuffix: true,
                    })}
                  </Text>
                  {!isFinished && !isStopped && (
                    <Badge colorPalette="blue" size="sm">
                      Running
                    </Badge>
                  )}
                  {isStopped && (
                    <Badge colorPalette="yellow" size="sm">
                      Stopped
                    </Badge>
                  )}
                  {isFinished && !isStopped && (
                    <Badge colorPalette="green" size="sm">
                      Completed
                    </Badge>
                  )}
                </HStack>

                <HStack justify="space-between">
                  <Text fontSize="sm" fontWeight="medium">
                    {run.progress}/{run.total} entries
                  </Text>
                  {avgPassRate !== undefined && (
                    <Text
                      fontSize="sm"
                      color={avgPassRate >= 0.7 ? "green.600" : "red.600"}
                      fontWeight="medium"
                    >
                      {(avgPassRate * 100).toFixed(0)}% pass
                    </Text>
                  )}
                  {avgPassRate === undefined && avgScore > 0 && (
                    <Text fontSize="sm" color="gray.600">
                      {(avgScore * 100).toFixed(0)}% score
                    </Text>
                  )}
                </HStack>

                {run.workflow_version && (
                  <Text fontSize="xs" color="gray.400">
                    v{run.workflow_version.version}
                  </Text>
                )}
              </VStack>
            </Box>
          );
        })}
      </VStack>
    </VStack>
  );
}

