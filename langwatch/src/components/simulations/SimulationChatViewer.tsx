import { SimulationCard } from "./SimulationCard";
import { CustomCopilotKitChat } from "./CustomCopilotKitChat";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTracedQuery } from "~/observability/react-otel/useTracedQuery";

// TODO: move this to hook wrapper
export function SimulationChatViewer({
  scenarioRunId,
}: {
  scenarioRunId: string;
  }) {
  const { project } = useOrganizationTeamProject();
  const { data } = useTracedQuery(api.scenarios.getRunState,
    {
      scenarioRunId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project,
    },
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
      <CustomCopilotKitChat
        messages={data?.messages ?? []}
        smallerView
        hideInput
      />
    </SimulationCard>
  );
}
