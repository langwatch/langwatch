import { SimulationCard } from "./SimulationCard";
import { CustomCopilotKitChat } from "./CustomCopilotKitChat";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

// TODO: move this to hook wrapper
export function SimulationChatViewer({
  scenarioRunId,
}: {
  scenarioRunId: string;
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
    >
      <CustomCopilotKitChat messages={data?.messages ?? []} />
    </SimulationCard>
  );
}
