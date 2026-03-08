import { Box } from "@chakra-ui/react";

import { SimulationLayout, SimulationZoomGrid } from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import {
  StreamingEventProvider,
  useStreamingEventDispatch,
} from "~/hooks/useStreamingEventDispatch";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { api } from "~/utils/api";

// Main layout for a single Simulation Set page
export default function SimulationSetPage() {
  return (
    <StreamingEventProvider>
      <SimulationSetPageInner />
    </StreamingEventProvider>
  );
}

function SimulationSetPageInner() {
  const { scenarioSetId } = useSimulationRouter();
  const { project } = useOrganizationTeamProject();
  const { batchRunId, goToSimulationBatchRuns } = useSimulationRouter();
  const dispatchStreamingEvent = useStreamingEventDispatch();

  // sinceTimestamp enables conditional fetch: server returns {changed:false} cheaply when idle
  const [sinceTimestamp, setSinceTimestamp] = useState<number | undefined>(undefined);
  // Centralised run data — cards receive data from here instead of polling independently
  const [runDataMap, setRunDataMap] = useState<Map<string, ScenarioRunData>>(new Map());
  const lastBatchRunIdRef = useRef<string | undefined>(undefined);

  // Per-run timestamps so the server only returns runs that actually changed
  const runTimestamps = useMemo(() => {
    if (runDataMap.size === 0) return undefined;
    const timestamps: Record<string, number> = {};
    for (const [id, run] of runDataMap) {
      timestamps[id] = run.timestamp;
    }
    return timestamps;
  }, [runDataMap]);

  const { data: batchRunData, refetch } = api.scenarios.getBatchRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: scenarioSetId ?? "",
      batchRunId: batchRunId ?? "",
      sinceTimestamp,
      runTimestamps,
    },
    {
      enabled: !!project?.id && !!scenarioSetId && !!batchRunId,
      refetchInterval: 30_000,
    },
  );

  // Fetch batch history to redirect when batchRunId is missing
  const { data: batchHistory } = api.scenarios.getScenarioSetBatchHistory.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: scenarioSetId ?? "",
      limit: 1,
    },
    {
      enabled: !!project?.id && !!scenarioSetId && !batchRunId,
    },
  );

  // Reset state when navigating to a different batch run
  useEffect(() => {
    if (batchRunId !== lastBatchRunIdRef.current) {
      lastBatchRunIdRef.current = batchRunId;
      setSinceTimestamp(undefined);
      setRunDataMap(new Map());
    }
  }, [batchRunId]);

  // Merge incoming run data into the map (delta updates from server)
  useEffect(() => {
    if (!batchRunData?.changed) return;

    setRunDataMap((prev) => {
      const next = new Map(prev);
      for (const run of batchRunData.runs) {
        next.set(run.scenarioRunId, run);
      }
      return next;
    });

    setSinceTimestamp(batchRunData.lastUpdatedAt);
  }, [batchRunData]);

  // Derive sorted run IDs from the map — stable order by creation timestamp
  const scenarioRunIds = useMemo(() => {
    if (runDataMap.size === 0) return [];
    return [...runDataMap.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((r) => r.scenarioRunId);
  }, [runDataMap]);

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
    onStreamingEvent: dispatchStreamingEvent,
  });

  // Redirect to latest batch run when batchRunId is missing
  useEffect(() => {
    if (!scenarioSetId || batchRunId) return;
    const latestRun = batchHistory?.batches?.[0];
    if (latestRun) {
      goToSimulationBatchRuns(scenarioSetId, latestRun.batchRunId, { replace: true });
    }
  }, [batchHistory, scenarioSetId, batchRunId, goToSimulationBatchRuns]);

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
            {scenarioRunIds.length > 0 && (
              <SimulationZoomGrid.Grid scenarioRunIds={scenarioRunIds} runDataMap={runDataMap} />
            )}
          </Box>
        </SimulationZoomGrid.Root>
      </PageLayout.Container>
    </SimulationLayout>
  );
}
