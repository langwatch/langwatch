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

import { isFinishedRunStatus } from "../../model/scenario-run-status.utils.ts";
import { storedDisplayText } from "../../model/stored-display-text.ts";
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
  const { streamingMessages, handleStreamingEvent, reconcileWithServer } =
    useSimulationStreamingState(scenarioRunId ?? undefined);

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

  // Settle streamed previews against the stored run once it moves on.
  useEffect(() => {
    if (!scenarioState) return;
    reconcileWithServer({
      serverMessages: (scenarioState.messages ?? []).map(
        (m: { id?: string; content?: unknown }) => ({
          id: m.id ?? "",
          text: storedDisplayText(m.content),
        }),
      ),
      isFinished: isFinishedRunStatus(scenarioState.status),
    });
  }, [scenarioState, reconcileWithServer]);

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
