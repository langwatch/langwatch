import { SimulationCard } from "./SimulationCard";
import { CustomCopilotKitChat } from "./CustomCopilotKitChat";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { convertScenarioMessagesToCopilotKit } from "./utils/convert-scenario-messages";
import { createLogger } from "~/utils/logger";
import { useMemo } from "react";

const logger = createLogger("SimulationChatViewer.tsx");

interface SimulationChatViewerProps {
  scenarioRunId: string;
}

/**
 * This component renders the chat history of a simulation.
 */
export function SimulationChatViewer({
  scenarioRunId,
}: SimulationChatViewerProps) {
  const { project } = useOrganizationTeamProject();
  const { data } = api.scenarios.getRunState.useQuery(
    {
      scenarioRunId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project && !!scenarioRunId,
      refetchInterval: 1000,
      // Use select to stabilize messages reference
      select: (data) => {
        // Only create new object if messages actually changed
        return {
          ...data,
          // Stringify for stable comparison (React Query will preserve reference if same)
          _messagesHash: JSON.stringify(data.messages),
        };
      },
    },
  );

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
  }, [data?.messages]);

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
      <CustomCopilotKitChat messages={messages} smallerView />
    </SimulationCard>
  );
}
