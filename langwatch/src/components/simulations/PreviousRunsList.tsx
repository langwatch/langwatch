import {
  Badge,
  Box,
  EmptyState,
  Flex,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import React, { useMemo } from "react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { ScenarioRunStatusIcon } from "~/components/simulations/ScenarioRunStatusIcon";

import "@copilotkit/react-ui/styles.css";
import { LuCircleOff } from "react-icons/lu";

import { useSimulationRouter } from "~/hooks/simulations";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export function getStatusBadgeProps(status: ScenarioRunStatus): {
  colorPalette: string;
  label: string;
} {
  switch (status) {
    case ScenarioRunStatus.SUCCESS:
      return { colorPalette: "green", label: "completed" };
    case ScenarioRunStatus.FAILED:
    case ScenarioRunStatus.ERROR:
      return { colorPalette: "red", label: "failed" };
    case ScenarioRunStatus.CANCELLED:
      return { colorPalette: "gray", label: "cancelled" };
    case ScenarioRunStatus.STALLED:
      return { colorPalette: "yellow", label: "stalled" };
    case ScenarioRunStatus.IN_PROGRESS:
    case ScenarioRunStatus.PENDING:
      return { colorPalette: "orange", label: "running" };
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled ScenarioRunStatus: ${_exhaustive}`);
    }
  }
}

function calculateAccuracyPercentage(
  results: ScenarioRunData["results"],
): number {
  const met = results?.metCriteria?.length ?? 0;
  const unmet = results?.unmetCriteria?.length ?? 0;
  const total = met + unmet;
  return total > 0 ? Math.round((met / total) * 100) : 0;
}

// Previous Runs List Component
export function PreviousRunsList({ scenarioId }: { scenarioId?: string }) {
  const { project } = useOrganizationTeamProject();
  const { goToSimulationRun, scenarioSetId, batchRunId } =
    useSimulationRouter();

  const { data: scenarioRunData, isLoading } =
    api.scenarios.getRunDataByScenarioId.useQuery(
      {
        projectId: project?.id ?? "",
        scenarioId: scenarioId ?? "",
      },
      {
        enabled: !!project?.id && !!scenarioId,
      },
    );

  const sortedRuns = useMemo(
    () =>
      scenarioRunData?.data
        ?.slice()
        .sort((a, b) => b.timestamp - a.timestamp) ?? [],
    [scenarioRunData?.data],
  );

  return (
    <VStack gap={3} align="stretch">
      {isLoading && (
        <Box p={4} w="100%">
          <VStack gap={4} align="start" w="100%">
            <Skeleton height="32px" width="60%" />
            <Skeleton height="24px" width="40%" />
            <Skeleton height="200px" width="100%" borderRadius="md" />
          </VStack>
        </Box>
      )}

      {!isLoading && scenarioRunData?.data?.length === 0 && (
        <EmptyState.Root size={"md"}>
          <EmptyState.Content>
            <EmptyState.Indicator>
              <LuCircleOff />
            </EmptyState.Indicator>
            <VStack textAlign="center">
              <EmptyState.Title>No previous runs found</EmptyState.Title>
              <EmptyState.Description>
                There are no simulations for this scenario yet
              </EmptyState.Description>
            </VStack>
          </EmptyState.Content>
        </EmptyState.Root>
      )}

      {sortedRuns.map((run: ScenarioRunData) => (
        <Box
          key={run.scenarioRunId}
          p={4}
          borderRadius="md"
          border="1px solid"
          borderColor="border"
          cursor="pointer"
          _hover={{ bg: "bg.muted" }}
          onClick={() => {
            if (scenarioSetId && batchRunId) {
              goToSimulationRun({
                scenarioSetId,
                batchRunId,
                scenarioRunId: run.scenarioRunId,
              });
            }
          }}
        >
          <VStack align="start" gap={3} w="100%">
            {/* Status Badge and Timestamp Row */}
            <Flex
              align="start"
              w="100%"
              flexWrap="wrap"
              gap={2}
              alignItems="center"
            >
              <ScenarioRunStatusIcon
                status={run.status as ScenarioRunStatus}
                boxSize={12}
              />
              <Badge
                colorPalette={getStatusBadgeProps(run.status).colorPalette}
                variant="subtle"
                display="flex"
                alignItems="center"
                gap={1}
                px={2}
                py={1}
                borderRadius="md"
              >
                <Text fontSize="xs" fontWeight="medium">
                  {getStatusBadgeProps(run.status).label}
                </Text>
              </Badge>
            </Flex>

            {/* Metrics Row */}
            <VStack align="start" gap={1} w="100%">
              <Box fontSize="xs" color="fg.muted">
                <Text>Duration: {Math.round(run.durationInMs / 1000)}s</Text>
                <Text>
                  Accuracy: {calculateAccuracyPercentage(run.results)}%
                </Text>
              </Box>
              <Text fontSize="xs" color="fg.subtle" whiteSpace="nowrap">
                {new Date(run.timestamp).toLocaleDateString()},{" "}
                {new Date(run.timestamp).toLocaleTimeString()}
              </Text>
            </VStack>
          </VStack>
        </Box>
      ))}
    </VStack>
  );
}
