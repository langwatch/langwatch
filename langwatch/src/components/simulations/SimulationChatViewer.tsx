import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/schemas";
import { useFetchScenarioState } from "~/hooks/simulations";
import { SimulationCard } from "./SimulationCard";
import { CustomCopilotKitChat } from "./CustomCopilotKitChat";
import { useEffect, useState } from "react";

export function SimulationChatViewer({
  scenarioRunId,
  isExpanded,
  onExpandToggle,
}: {
  scenarioRunId: string;
  isExpanded: boolean;
  onExpandToggle: () => void;
}) {
  const [status, setStatus] = useState<ScenarioRunStatus>(
    ScenarioRunStatus.IN_PROGRESS
  );

  // Fetch scenario state for this thread
  const { data: scenarioState } = useFetchScenarioState({
    scenarioRunId,
    options: {
      refreshInterval: status === ScenarioRunStatus.IN_PROGRESS ? 1000 : 0,
    },
  });

  useEffect(() => {
    if (scenarioState?.status) {
      setStatus(scenarioState.status);
    }
  }, [scenarioState]);

  return (
    <SimulationCard
      title={`Simulation ${scenarioRunId}`}
      status={status}
      onExpandToggle={onExpandToggle}
      isExpanded={isExpanded}
    >
      <CustomCopilotKitChat messages={scenarioState?.messages ?? []} />
    </SimulationCard>
  );
}
