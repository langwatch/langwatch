import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";
import { CustomCopilotKitChat } from "./CustomCopilotKitChat";
import { SimulationCard } from "./SimulationCard";

export function SimulationChatViewer({ data }: { data: ScenarioRunData }) {
  return (
    <SimulationCard
      title={
        data.name ??
        data.scenarioId ??
        data.timestamp.toString()
      }
      status={data.status}
    >
      <CustomCopilotKitChat
        messages={data.messages ?? []}
        smallerView
        hideInput
      />
    </SimulationCard>
  );
}
