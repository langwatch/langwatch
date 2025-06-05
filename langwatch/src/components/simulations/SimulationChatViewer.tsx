import { useFetchScenarioRunData } from "~/hooks/simulations";
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
  const { data } = useFetchScenarioRunData({
    scenarioRunId,
  });

  return (
    <SimulationCard
      title={`Simulation ${scenarioRunId}`}
      status={data?.status}
      onExpandToggle={onExpandToggle}
      isExpanded={isExpanded}
      runAt={new Date(data?.timestamp ?? new Date())}
    >
      <CustomCopilotKitChat messages={data?.messages ?? []} />
    </SimulationCard>
  );
}
