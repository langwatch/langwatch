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
export function SimulationSetPage({
  scenarioSetId,
}: {
  scenarioSetId: string;
}) {
  const { project } = useOrganizationTeamProject();
  const { batchRunId, goToSimulationBatchRuns } = useSimulationRouter();

  const { data: scenarioSetData } =
    api.scenarios.getScenarioSetRunData.useQuery(
      {
        projectId: project?.id ?? "",
        scenarioSetId,
      },
      {
        enabled: !!project?.id && !!scenarioSetId,
        refetchInterval: 1000,
      }
    );

  const scenarioRunIds = useMemo(
    () =>
      scenarioSetData
        ?.sort((a, b) => {
          return (
            new Date(a.timestamp ?? 0).getTime() -
            new Date(b.timestamp ?? 0).getTime()
          );
        })
        ?.filter((scenario) => scenario.batchRunId === batchRunId)
        ?.map((scenario) => scenario.scenarioRunId),
    [scenarioSetData, batchRunId]
  );

  useEffect(() => {
    if (!batchRunId) {
      const length = scenarioSetData?.length ?? 0;
      const batchRunId = scenarioSetData?.[length - 1]?.batchRunId;
      if (!batchRunId) return;
      goToSimulationBatchRuns(scenarioSetId, batchRunId, { replace: true });
    }
  }, [scenarioSetData]);

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
