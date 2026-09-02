/**
 * The live state of one scenario run: the stored record, the streamed deltas,
 * and the poll that stands in while the event stream is down.
 */

import { useEffect } from "react";
import { useSimulationStreamingState } from "../use-simulation-streaming-state";
import { useSimulationUpdateListener } from "../use-simulation-update-listener";
import { api, type RouterOutputs } from "../scenario-api";
import { getRunStatePollInterval } from "../../index";

/** The run record as the run-state read returns it. */
export type ScenarioRunState = RouterOutputs["scenarios"]["getRunState"];

export function useRunStateStream({
  scenarioRunId,
  projectId,
  isOpen,
}: {
  scenarioRunId: string | undefined;
  projectId: string | undefined;
  isOpen: boolean;
}) {
  const { streamingMessages, handleStreamingEvent, clearCompleted } =
    useSimulationStreamingState(scenarioRunId ?? undefined);

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

  const { data: scenarioState, error: runStateError } =
    api.scenarios.getRunState.useQuery(
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

  return { scenarioState, runStateError, streamingMessages };
}
