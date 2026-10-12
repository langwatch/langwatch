/**
 * The live state of one scenario run: the stored record, the streamed deltas,
 * and the poll that stands in while the event stream is down.
 */

import { useEffect } from "react";
import { useSimulationStreamingState } from "~/hooks/useSimulationStreamingState";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import { api, type RouterOutputs } from "~/utils/api";
import {
  getRunStatePollInterval,
  isFinishedRunStatus,
} from "./run-state-polling";

/** The run record as the run-state read returns it. */
export type ScenarioRunState = RouterOutputs["scenarios"]["getRunState"];

/**
 * Stored content as the text a preview would show: a string, or the text
 * parts of a content array (stored as JSON). A START row holds "".
 */
export function storedDisplayText(content: unknown): string {
  if (typeof content === "string") {
    if (!content.startsWith("[")) return content.trim();
    try {
      return storedDisplayText(JSON.parse(content));
    } catch {
      return content.trim();
    }
  }
  if (!Array.isArray(content)) return "";
  return content
    .map((part: { type?: unknown; text?: unknown }) =>
      part?.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .join("")
    .trim();
}

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
  const { isConnected: sseConnected } = useSimulationUpdateListener({
    projectId: projectId ?? "",
    enabled: isWatching,
    debounceMs: 300,
    filter: scenarioRunId ? { scenarioRunId } : undefined,
    onStreamingEvent: handleStreamingEvent,
  });

  const {
    data: scenarioState,
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
