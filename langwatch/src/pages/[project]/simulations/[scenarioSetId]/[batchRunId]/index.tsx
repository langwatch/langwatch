import { Box } from "@chakra-ui/react";
import { SimulationZoomGrid, SimulationLayout } from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import "@copilotkit/react-ui/styles.css";
import "../../simulations.css";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { useEffect, useMemo } from "react";

// Main layout for a single Simulation Set page
export default function SimulationSetPage() {
  const { scenarioSetId } = useSimulationRouter();
  const { project } = useOrganizationTeamProject();
  const { batchRunId, goToSimulationBatchRuns } = useSimulationRouter();

  const { data: scenarioSetData } =
    api.scenarios.getScenarioSetRunData.useQuery(
      {
        projectId: project?.id ?? "",
        scenarioSetId: scenarioSetId ?? "",
      },
      {
        enabled: !!project?.id && !!scenarioSetId,
        refetchInterval: 1000,
      }
    );

  const sortedScenarioSetData = useMemo(() => {
    return [...(scenarioSetData ?? [])].sort((a, b) => {
      return a.timestamp - b.timestamp;
    });
  }, [scenarioSetData]);

  const scenarioRunIds = useMemo(
    () =>
      sortedScenarioSetData
        ?.filter((scenario) => scenario.batchRunId === batchRunId)
        ?.map((scenario) => scenario.scenarioRunId),
    [sortedScenarioSetData, batchRunId]
  );

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
            {scenarioRunIds && scenarioRunIds.length > 0 && (
              <SimulationZoomGrid.Grid scenarioRunIds={scenarioRunIds} />
            )}
          </Box>
        </SimulationZoomGrid.Root>
      </PageLayout.Container>
    </SimulationLayout>
  );
}
