import { SimulationCard } from "./SimulationCard";
import { convertScenarioMessagesToCopilotKit } from "./utils/convert-scenario-messages";
import { createLogger } from "~/utils/logger";
import { useMemo } from "react";
import { SimpleChatUI } from "./simple-chat";
import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";

const logger = createLogger("SimulationChatViewer.tsx");

interface SimulationChatViewerProps {
  runState?: ScenarioRunData;
}

/**
 * Renders the chat history of a simulation with per-card memoization.
 *
 * Single Responsibility: Display a single scenario run's chat interface with optimized message transformation.
 *
 * Message transformation is memoized per-card based on messages.length.
 * This ensures only cards with changed conversations re-transform, not all cards on every update.
 */
export function SimulationChatViewer({ runState }: SimulationChatViewerProps) {
  /**
   * Per-card memoized message transformation.
   * Only re-transforms when message count changes (append-only optimization).
   * TanStack Query structural sharing ensures unchanged runStates keep same reference.
   */
  const messages = useMemo(() => {
    console.log(
      `scenario run id: ${runState?.scenarioRunId} messages rerendered`,
    );
    try {
      return convertScenarioMessagesToCopilotKit(runState?.messages ?? []);
    } catch (error) {
      logger.error(
        {
          error,
        },
        "Failed to convert scenario messages to CopilotKit messages",
      );
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runState?.messages?.length, runState?.scenarioRunId]);

  return (
    <SimulationCard
      title={
        runState?.name ??
        runState?.scenarioId ??
        runState?.timestamp?.toString() ??
        "scenario"
      }
      status={runState?.status}
    >
      <SimpleChatUI messages={messages} smallerView />
    </SimulationCard>
  );
}
