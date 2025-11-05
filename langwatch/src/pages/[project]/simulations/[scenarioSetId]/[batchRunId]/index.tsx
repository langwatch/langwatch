import { Box } from "@chakra-ui/react";

import { SimulationZoomGrid, SimulationLayout } from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import "@copilotkit/react-ui/styles.css";
import "../../simulations.css";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { useBatchRunStates } from "~/hooks/simulations/useSimulationQueries";

/**
 * Simulation Set Page - Displays a grid of scenario runs for a specific batch run.
 *
 * Single Responsibility: Renders the simulation batch run viewer with batch-optimized data fetching.
 *
 * URL Structure: /[project]/simulations/[scenarioSetId]/[batchRunId]
 *
 * Note: Auto-redirect to most recent batch run is handled by the sidebar
 * (see useSetRunHistorySidebarController lines 86-94)
 */
export default function SimulationSetPage() {
  const { scenarioSetId, batchRunId } = useSimulationRouter();

  /**
   * Fetch all run states in a single batch query.
   * Returns a map of scenarioRunId -> complete run state data.
   * Adaptive polling: faster when many active, slower when few remaining, stops when all complete.
   *
   * Message transformation is handled per-card for optimal granular memoization.
   */
  const { data: runStatesMap } = useBatchRunStates({
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
            {runStatesMap && Object.keys(runStatesMap).length > 0 && (
              <SimulationZoomGrid.Grid runStatesMap={runStatesMap} />
            )}
          </Box>
        </SimulationZoomGrid.Root>
      </PageLayout.Container>
    </SimulationLayout>
  );
}
