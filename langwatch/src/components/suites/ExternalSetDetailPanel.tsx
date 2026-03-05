/**
 * Read-only detail panel for external SDK/CI scenario sets.
 *
 * Displays the set name and batch run history without any
 * Run, Edit, or Run Again actions.
 */

import {
  Box,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useCallback, useMemo, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { api } from "~/utils/api";
import { buildRoutePath } from "~/utils/routes";
import {
  computeBatchRunSummary,
  groupRunsByBatchId,
} from "./run-history-transforms";
import { RunRow } from "./RunRow";

type ExternalSetDetailPanelProps = {
  scenarioSetId: string;
};

export function ExternalSetDetailPanel({
  scenarioSetId,
}: ExternalSetDetailPanelProps) {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const {
    data: runData,
    isLoading,
    error,
  } = api.scenarios.getAllScenarioSetRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId,
    },
    {
      enabled: !!project,
      refetchInterval: 5000,
    },
  );

  const batchRuns = useMemo(() => {
    if (!runData) return [];
    return groupRunsByBatchId({ runs: runData });
  }, [runData]);

  const toggleExpanded = useCallback((batchRunId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchRunId)) {
        next.delete(batchRunId);
      } else {
        next.add(batchRunId);
      }
      return next;
    });
  }, []);

  const handleScenarioRunClick = useCallback(
    (run: ScenarioRunData) => {
      if (!project) return;
      const path = buildRoutePath("simulations_run", {
        project: project.slug,
        scenarioSetId,
        batchRunId: run.batchRunId,
        scenarioRunId: run.scenarioRunId,
      });
      void router.push(path);
    },
    [project, router, scenarioSetId],
  );

  // External sets have no target resolution
  const resolveTargetName = useCallback(() => null, []);

  return (
    <VStack align="stretch" gap={0} height="100%">
      {/* Header */}
      <HStack
        paddingX={6}
        paddingY={4}
        borderBottom="1px solid"
        borderColor="border"
        justify="space-between"
      >
        <VStack align="start" gap={0}>
          <Text
            fontSize="xs"
            fontWeight="bold"
            color="fg.muted"
            letterSpacing="wider"
          >
            EXTERNAL SET
          </Text>
          <Text fontSize="lg" fontWeight="semibold">
            {scenarioSetId}
          </Text>
        </VStack>
      </HStack>

      {/* Content */}
      <Box flex={1} overflow="auto" paddingY={2}>
        {isLoading && (
          <VStack paddingY={8}>
            <Spinner />
            <Text fontSize="sm" color="fg.muted">
              Loading run data...
            </Text>
          </VStack>
        )}

        {error && (
          <VStack paddingY={8}>
            <Text color="red.500">Error loading run data</Text>
            <Text fontSize="sm" color="fg.muted">
              {error.message}
            </Text>
          </VStack>
        )}

        {!isLoading && !error && batchRuns.length === 0 && (
          <VStack paddingY={8}>
            <Text fontSize="sm" color="fg.muted">
              No run data found for this set.
            </Text>
          </VStack>
        )}

        {!isLoading &&
          !error &&
          batchRuns.map((batch) => {
            const summary = computeBatchRunSummary({ batchRun: batch });
            return (
              <RunRow
                key={batch.batchRunId}
                batchRun={batch}
                summary={summary}
                isExpanded={expandedIds.has(batch.batchRunId)}
                onToggle={() => toggleExpanded(batch.batchRunId)}
                resolveTargetName={resolveTargetName}
                onScenarioRunClick={handleScenarioRunClick}
              />
            );
          })}
      </Box>
    </VStack>
  );
}
