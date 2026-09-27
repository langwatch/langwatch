/**
 * The live state of one scenario run: the stored record, the streamed deltas,
 * and the poll that stands in while the event stream is down.
 */

import {
  simulationRunMetadataSchema,
  type SimulationRunMetadata,
} from "@langwatch/scenario-contract";
import { useEffect, useMemo } from "react";

import { getRunStatePollInterval } from "../../model/run-state-polling.ts";
import { api, type RouterOutputs } from "../scenario-api.ts";
import { useSimulationStreamingState } from "../use-simulation-streaming-state.ts";
import { useSimulationUpdateListener } from "../use-simulation-update-listener.ts";

/**
 * The run record as the run-state read returns it, with its metadata read through the contract:
 * the wire's loose metadata object loses its known keys in the serialized type.
 */
export type ScenarioRunState = Omit<RouterOutputs["scenarios"]["getRunState"], "metadata"> & {
  metadata?: SimulationRunMetadata;
};

export function useRunStateStream({
  scenarioRunId,
  projectId,
  isOpen,
}: {
  scenarioRunId: string | undefined;
  projectId: string | undefined;
  isOpen: boolean;
}) {
  const { streamingMessages, handleStreamingEvent, clearCompleted } = useSimulationStreamingState(
    scenarioRunId ?? undefined,
  );

  const isWatching = !!projectId && !!scenarioRunId && isOpen;

  // Live updates: matching SSE events selectively invalidate getRunState for
  // this run, and streaming deltas flow through the streaming state above.
  const { isConnected: sseConnected } = useSimulationUpdateListener({
    projectId: projectId ?? "",
    enabled: isWatching,
    debounceMs: 300,
    filter: scenarioRunId ? { scenarioRunId } : undefined,
    onStreamingEvent: handleStreamingEvent,
  });

  const {
    data: runState,
    error: runStateError,
    isLoading: isRunStateLoading,
  } = api.scenarios.getRunState.useQuery(
    { scenarioRunId: scenarioRunId ?? "", projectId: projectId ?? "" },
    {
      enabled: isWatching,
      // Finished runs never change, so polling stops entirely. Live runs poll
      // fast only while the event stream is down.
      refetchInterval: (query) =>
        getRunStatePollInterval({
          status: query.state.data?.status,
          sseConnected,
        }),
    },
  );

  const scenarioState = useMemo(() => withParsedMetadata(runState), [runState]);

  // Clear streaming messages once server data includes them
  useEffect(() => {
    if (scenarioState?.messages) {
      clearCompleted(
        scenarioState.messages
          .map((m: { id?: string }) => m.id)
          .filter((id: string | undefined): id is string => !!id),
      );
    }
  }, [scenarioState?.messages, clearCompleted]);

  return {
    scenarioState,
    runStateError,
    streamingMessages,
    isRunStateLoading: isWatching && isRunStateLoading,
  };
}

function withParsedMetadata(
  runState: RouterOutputs["scenarios"]["getRunState"] | undefined,
): ScenarioRunState | undefined {
  if (!runState) return undefined;
  const metadata = simulationRunMetadataSchema.safeParse(runState.metadata);
  return { ...runState, metadata: metadata.success ? metadata.data : undefined };
}
