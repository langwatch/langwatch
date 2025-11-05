import { Box } from "@chakra-ui/react";

import { SimulationZoomGrid, SimulationLayout } from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import "@copilotkit/react-ui/styles.css";
import "../../simulations.css";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { useScenarioRunIds } from "~/hooks/simulations/useSimulationQueries";

/**
 * Simulation Set Page - Displays a grid of scenario runs for a specific batch run.
 *
 * Single Responsibility: Renders the simulation batch run viewer with optimized data fetching.
 *
 * URL Structure: /[project]/simulations/[scenarioSetId]/[batchRunId]
 *
 * Note: Auto-redirect to most recent batch run is handled by the sidebar
 * (see useSetRunHistorySidebarController lines 86-94)
 */
export default function SimulationSetPage() {
  const { scenarioSetId, batchRunId } = useSimulationRouter();

  /**
   * Fetch lightweight scenario run IDs using centralized hook.
   * Full run data is fetched individually by each card component.
   */
  const { data: scenarioRunIds } = useScenarioRunIds({
    scenarioSetId,
    batchRunId,
  });

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
