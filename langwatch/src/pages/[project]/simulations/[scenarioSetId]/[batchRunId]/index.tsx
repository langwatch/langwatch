import { Box } from "@chakra-ui/react";

import { SimulationLayout, SimulationZoomGrid } from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import "@copilotkit/react-ui/styles.css";
import "../../simulations.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import { api } from "~/utils/api";

// Main layout for a single Simulation Set page
export default function SimulationSetPage() {
  const { scenarioSetId } = useSimulationRouter();
  const { project } = useOrganizationTeamProject();
  const { batchRunId, goToSimulationBatchRuns } = useSimulationRouter();

  // sinceTimestamp enables conditional fetch: server returns {changed:false} cheaply when idle
  const [sinceTimestamp, setSinceTimestamp] = useState<number | undefined>(undefined);
  // Stable ordered run IDs — only updated when the server says something changed
  const [scenarioRunIds, setScenarioRunIds] = useState<string[]>([]);
  const lastBatchRunIdRef = useRef<string | undefined>(undefined);

  const { data: batchRunData, refetch } = api.scenarios.getBatchRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: scenarioSetId ?? "",
      batchRunId: batchRunId ?? "",
      sinceTimestamp,
    },
    {
      enabled: !!project?.id && !!scenarioSetId && !!batchRunId,
      refetchInterval: 10_000,
    },
  );

  // Reset state when navigating to a different batch run
  useEffect(() => {
    if (batchRunId !== lastBatchRunIdRef.current) {
      lastBatchRunIdRef.current = batchRunId;
      setSinceTimestamp(undefined);
      setScenarioRunIds([]);
    }
  }, [batchRunId]);

  // Update stable run IDs only when data has actually changed
  useEffect(() => {
    if (!batchRunData?.changed) return;
    const sorted = [...batchRunData.runs].sort((a, b) => a.timestamp - b.timestamp);
    setScenarioRunIds(sorted.map((r) => r.scenarioRunId));
    setSinceTimestamp(batchRunData.lastUpdatedAt);
  }, [batchRunData]);

  const trpcUtils = api.useContext();

  const handleNewBatchRun = useCallback(
    (newBatchRunId: string) => {
      if (!project?.id || !scenarioSetId || newBatchRunId === batchRunId) return;
      // Prefetch the new batch run data so clicking it in the sidebar is instant
      void trpcUtils.scenarios.getBatchRunData.prefetch({
        projectId: project.id,
        scenarioSetId,
        batchRunId: newBatchRunId,
      });
    },
    [project?.id, scenarioSetId, batchRunId, trpcUtils],
  );

  useSimulationUpdateListener({
    projectId: project?.id ?? "",
    refetch,
    enabled: !!project?.id && !!batchRunId,
    debounceMs: 300,
    filter: batchRunId ? { batchRunId } : undefined,
    onNewBatchRun: handleNewBatchRun,
  });

  useEffect(() => {
    if (!scenarioSetId) return;
    if (!batchRunId && batchRunData?.changed && batchRunData.runs.length > 0) {
      const lastRun = batchRunData.runs[batchRunData.runs.length - 1];
      if (lastRun) goToSimulationBatchRuns(scenarioSetId, lastRun.batchRunId, { replace: true });
    }
  }, [batchRunData, scenarioSetId, batchRunId, goToSimulationBatchRuns]);

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
