import { Box } from "@chakra-ui/react";

import { SimulationZoomGrid, SimulationLayout } from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import "@copilotkit/react-ui/styles.css";
import "../../simulations.css";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import { useEffect, useMemo } from "react";

/**
 * Simulation Set Page - Displays a grid of scenario runs for a specific batch run.
 *
 * Single Responsibility: Renders the simulation batch run viewer and handles auto-redirect
 * to the most recent batch run when no batchRunId is provided in the URL.
 *
 * URL Structure: /[project]/simulations/[scenarioSetId]/[batchRunId]
 *
 * Auto-redirect behavior: If user navigates to /[project]/simulations/[scenarioSetId]
 * (without batchRunId), this component automatically redirects to the most recent batch run.
 */
export default function SimulationSetPage() {
  const { scenarioSetId } = useSimulationRouter();
  const { project } = useOrganizationTeamProject();
  const { batchRunId, goToSimulationBatchRuns } = useSimulationRouter();

  const { data: scenarioSetData } = api.scenarios.getBatchRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: scenarioSetId ?? "",
      batchRunId: batchRunId ?? "",
    },
    {
      enabled: !!scenarioSetId && !!batchRunId,
      refetchInterval: 1000,
    },
  );

  const sortedScenarioSetData = useMemo(() => {
    return [...(scenarioSetData ?? [])].sort((a, b) => {
      return a.timestamp - b.timestamp;
    });
  }, [scenarioSetData]);

  const scenarioRunIds = useMemo(
    () => sortedScenarioSetData?.map((scenario) => scenario.scenarioRunId),
    [sortedScenarioSetData],
  );

  /**
   * Auto-redirect to most recent batch run when batchRunId is missing from URL.
   *
   * This ensures users who navigate to /simulations/[scenarioSetId] (without a batchRunId)
   * are automatically redirected to view the latest batch run. Uses replace: true to avoid
   * polluting browser history with the incomplete URL.
   *
   * Note: Only triggers once when batchRunId is initially missing. Won't auto-navigate to
   * newer runs as they complete (despite refetchInterval) since batchRunId will already be set.
   */
  useEffect(() => {
    if (!scenarioSetId) return;
    if (!batchRunId) {
      const length = sortedScenarioSetData?.length ?? 0;
      const batchRunId = sortedScenarioSetData?.[length - 1]?.batchRunId;
      if (!batchRunId) return;
      goToSimulationBatchRuns(scenarioSetId, batchRunId, { replace: true });
    }
  }, [
    sortedScenarioSetData,
    scenarioSetId,
    batchRunId,
    goToSimulationBatchRuns,
  ]);

  return (
    <SimulationLayout>
      <PageLayout.Container
        marginTop={0}
        h="full"
        overflow="scroll"
        padding={0}
        position="absolute"
      >
        <SimulationZoomGrid.Root>
          <Box p={6}>
            <Box mb={4}>
              <SimulationZoomGrid.Controls />
            </Box>
            {scenarioRunIds && scenarioRunIds.length > 0 && (
              <SimulationZoomGrid.Grid scenarioRunIds={scenarioRunIds} />
            )}
          </Box>
        </SimulationZoomGrid.Root>
      </PageLayout.Container>
    </SimulationLayout>
  );
}
