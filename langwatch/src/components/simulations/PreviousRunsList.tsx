import {
  Box,
  Text,
  VStack,
  Badge,
  Flex,
  Skeleton,
  EmptyState,
} from "@chakra-ui/react";
import React from "react";
import { Check } from "react-feather";

import "@copilotkit/react-ui/styles.css";
import { LuCircleOff } from "react-icons/lu";

import { useSimulationRouter } from "~/hooks/simulations";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

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
      }
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

      {scenarioRunData?.data?.map((run) => (
        <Box
          key={run.scenarioRunId}
          p={4}
          borderRadius="md"
          border="1px solid"
          borderColor="gray.200"
          cursor="pointer"
          _hover={{ bg: "gray.100" }}
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
              {run.status === "SUCCESS" && <Check size={12} />}
              <Badge
                colorScheme={run.status === "SUCCESS" ? "green" : "orange"}
                variant="subtle"
                display="flex"
                alignItems="center"
                gap={1}
                px={2}
                py={1}
                borderRadius="md"
              >
                <Text fontSize="xs" fontWeight="medium">
                  {run.status === "SUCCESS" ? "completed" : "running"}
                </Text>
              </Badge>
            </Flex>

            {/* Metrics Row */}
            <VStack align="start" gap={1} w="100%">
              <Text fontSize="xs" color="gray.600">
                <Text>Duration: {Math.round(run.durationInMs / 1000)}s</Text>
                <Text>
                  Accuracy:{" "}
                  {run.results?.metCriteria?.length &&
                  run.results?.unmetCriteria?.length
                    ? (run.results?.metCriteria?.length /
                        (run.results?.metCriteria?.length +
                          run.results?.unmetCriteria?.length)) *
                      100
                    : 0}
                  %
                </Text>
              </Text>
              <Text fontSize="xs" color="gray.400" whiteSpace="nowrap">
                {new Date(run.timestamp).toLocaleDateString()},{" "}
                {new Date(run.timestamp).toLocaleTimeString()}
              </Text>
            </VStack>
          </VStack>
        </Box>
      )) ?? (
        <Text color="gray.500" fontSize="sm">
          No previous runs found
        </Text>
      )}
    </VStack>
  );
}
