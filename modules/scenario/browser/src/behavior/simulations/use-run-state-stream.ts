/**
 * The live state of one scenario run: the stored record, the streamed deltas,
 * and the stream that keeps them live.
 */

import { scenarioClient, type ScenarioOutputs } from "@langwatch/scenario-client";
import {
  simulationRunMetadataSchema,
  type SimulationRunMetadata,
} from "@langwatch/scenario-contract";
import { useEffect, useMemo } from "react";

import { useSimulationStreamingState } from "../use-simulation-streaming-state.ts";
import { useSimulationUpdateListener } from "../use-simulation-update-listener.ts";

/**
 * The run record as the run-state read returns it, with its metadata read through the contract:
 * the wire's loose metadata object loses its known keys in the serialized type.
 */
export type ScenarioRunState = Omit<ScenarioOutputs["scenarios"]["getRunState"], "metadata"> & {
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
  useSimulationUpdateListener({
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
  } = scenarioClient.scenarios.getRunState.useQuery(
    { scenarioRunId: scenarioRunId ?? "", projectId: projectId ?? "" },
    {
      enabled: isWatching,
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
  runState: ScenarioOutputs["scenarios"]["getRunState"] | undefined,
): ScenarioRunState | undefined {
  if (!runState) return undefined;
  const metadata = simulationRunMetadataSchema.safeParse(runState.metadata);
  return { ...runState, metadata: metadata.success ? metadata.data : undefined };
}
