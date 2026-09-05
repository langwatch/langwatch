import {
  FoundryRuntimeProvider,
  type FoundryProject,
  type FoundryTransport,
} from "../../behavior/foundry-runtime";
import { useCallback, useMemo, type ReactNode } from "react";
import { useOpsHost } from "../../../../model/ops-host";
import { api } from "../../../../behavior/ops-api";
import type { OpsOrganizationGraph } from "../../../../behavior/ops-api";

/** Flattens every project across every team of every organization into a flat FoundryProject list. */
function flattenFoundryProjects(organizations: OpsOrganizationGraph[]): FoundryProject[] {
  return organizations.flatMap((organization) =>
    organization.teams.flatMap((team) => mapTeamProjects(organization.name, team)),
  );
}

/** Maps one team's projects to FoundryProject rows, carrying the org name through. */
function mapTeamProjects(
  orgName: string,
  team: OpsOrganizationGraph["teams"][number],
): FoundryProject[] {
  return team.projects.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    slug: candidate.slug,
    apiKey: candidate.apiKey,
    orgName,
    teamName: team.name,
  }));
}

export function FoundryTransport({
  children,
  includeProjects = false,
}: {
  children: ReactNode;
  includeProjects?: boolean;
}) {
  // The project the operator is standing in, and its key: a generated trace
  // is sent with the project's own API key, so the host answers both.
  const project = useOpsHost().project();
  const organizations = api.organization.getAll.useQuery(
    { isDemo: false },
    { enabled: includeProjects, staleTime: 60_000 },
  );
  const apiUtils = api.useUtils();

  const projects = useMemo<FoundryProject[]>(() => {
    if (!organizations.data) {
      return [];
    }

    return flattenFoundryProjects(organizations.data);
  }, [organizations.data]);

  const loadPrompts = useCallback<FoundryTransport["loadPrompts"]>(
    async (projectId) => {
      const prompts = await apiUtils.prompts.getAllPromptsForProject.fetch({ projectId });

      return prompts.map((prompt) => ({
        id: prompt.id,
        version: prompt.version,
        versionId: prompt.versionId,
        handle: prompt.handle,
        model: prompt.model ?? void 0,
        inputs: prompt.inputs ?? [],
      }));
    },
    [apiUtils.prompts.getAllPromptsForProject],
  );

  const transport = useMemo<FoundryTransport>(
    () => ({
      currentProject: project ? { id: project.id, apiKey: project.apiKey } : void 0,
      projects,
      loadPrompts,
    }),
    [loadPrompts, project, projects],
  );

  return <FoundryRuntimeProvider transport={transport}>{children}</FoundryRuntimeProvider>;
}
