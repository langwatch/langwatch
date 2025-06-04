import { useFetchScenarioState } from "~/hooks/simulations";
import { SimulationCard } from "./SimulationCard";
import { CustomCopilotKitChat } from "./CustomCopilotKitChat";

export function SimulationChatViewer({
  scenarioRunId,
  isExpanded,
  onExpandToggle,
}: {
  scenarioRunId: string;
  isExpanded: boolean;
  onExpandToggle: () => void;
}) {
  // Fetch scenario state for this thread
  const { data: scenarioState } = useFetchScenarioState({
    scenarioRunId,
  });

  return (
    <SimulationCard
      title={`Simulation ${scenarioRunId}`}
      status={scenarioState?.status}
      onExpandToggle={onExpandToggle}
      isExpanded={isExpanded}
    >
      <CustomCopilotKitChat messages={scenarioState?.messages ?? []} />
    </SimulationCard>
  );
}
