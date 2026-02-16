import { Box } from "@chakra-ui/react";

import { SimulationLayout, SimulationZoomGrid } from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import "@copilotkit/react-ui/styles.css";
import "../../simulations.css";

import { useEffect, useMemo } from "react";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

// Main layout for a single Simulation Set page
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
      enabled: !!project?.id && !!scenarioSetId && !!batchRunId,
      refetchInterval: 1000,
    },
  );

  const sortedScenarioSetData = useMemo(() => {
    return [...(scenarioSetData ?? [])].sort((a, b) => {
      return a.timestamp - b.timestamp;
    });
  }, [scenarioSetData]);

  useEffect(() => {
    if (!scenarioSetId) return;
    if (!batchRunId) {
      const length = sortedScenarioSetData?.length ?? 0;
      const batchRunId = sortedScenarioSetData?.[length - 1]?.batchRunId;
      if (!batchRunId) return;
      goToSimulationBatchRuns(scenarioSetId, batchRunId, { replace: true });
    }
  }, [scenarioSetData, scenarioSetId, batchRunId, goToSimulationBatchRuns]);

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
            {sortedScenarioSetData.length > 0 && (
              <SimulationZoomGrid.Grid runs={sortedScenarioSetData} />
            )}
          </Box>
        </SimulationZoomGrid.Root>
      </PageLayout.Container>
    </SimulationLayout>
  );
}
