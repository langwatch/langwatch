import { SimulationCard } from "./SimulationCard";
import { CustomCopilotKitChat } from "./CustomCopilotKitChat";
import { useScenarioRunState } from "~/hooks/simulations/useSimulationQueries";
import { convertScenarioMessagesToCopilotKit } from "./utils/convert-scenario-messages";
import { createLogger } from "~/utils/logger";
import { useMemo } from "react";

const logger = createLogger("SimulationChatViewer.tsx");

interface SimulationChatViewerProps {
  scenarioRunId: string;
}

/**
 * This component renders the chat history of a simulation.
 * Uses centralized query hook with automatic polling that stops when run completes.
 */
export function SimulationChatViewer({
  scenarioRunId,
}: SimulationChatViewerProps) {
  const { data } = useScenarioRunState({
    scenarioRunId,
    enabled: !!scenarioRunId,
  });

  const messages = useMemo(() => {
    try {
      return convertScenarioMessagesToCopilotKit(data?.messages ?? []);
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
  }, [(data as any)?._messagesHash]);

  return (
    <SimulationCard
      title={
        data?.name ??
        data?.scenarioId ??
        data?.timestamp.toString() ??
        "scenario"
      }
      status={data?.status}
    >
      <CustomCopilotKitChat messages={[]} smallerView />
    </SimulationCard>
  );
}
