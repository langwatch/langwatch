import { SimulationCard } from "./SimulationCard";
import { CustomCopilotKitChat } from "./CustomCopilotKitChat";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export function SimulationChatViewer({
  scenarioRunId,
  isExpanded,
  onExpandToggle,
}: {
  scenarioRunId: string;
  isExpanded?: boolean;
  onExpandToggle?: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  const { data } = api.scenarios.getRunState.useQuery(
    {
      scenarioRunId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project,
    }
  );

  return (
    <SimulationCard
      title={
        data?.name ??
        data?.scenarioId ??
        data?.timestamp.toString() ??
        "scenario"
      }
      status={data?.status}
      onExpandToggle={onExpandToggle}
      isExpanded={isExpanded}
      runAt={new Date(data?.timestamp ?? new Date())}
    >
      <CustomCopilotKitChat messages={data?.messages ?? []} />
    </SimulationCard>
  );
}
