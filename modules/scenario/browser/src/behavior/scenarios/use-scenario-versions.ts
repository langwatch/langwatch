import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { scenarioClient } from "@langwatch/scenario-client";

/** The saved versions of one scenario, newest first. */
export function useScenarioVersions({ scenarioId }: { scenarioId: string }) {
  const { project } = useOrganizationTeamProject();
  return scenarioClient.scenarios.listVersions.useQuery(
    { projectId: project?.id ?? "", scenarioId },
    { enabled: !!project?.id && !!scenarioId },
  );
}

/** What one saved version of a scenario held. */
export function useScenarioVersion({
  scenarioId,
  version,
}: {
  scenarioId: string;
  version: number;
}) {
  const { project } = useOrganizationTeamProject();
  return scenarioClient.scenarios.getVersion.useQuery(
    { projectId: project?.id ?? "", scenarioId, version },
    { enabled: !!project?.id && !!scenarioId },
  );
}
