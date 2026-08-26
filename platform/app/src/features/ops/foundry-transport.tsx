import {
  FoundryRuntimeProvider,
  type FoundryProject,
  type FoundryTransport,
} from "@langwatch/ops-web";
import { useCallback, useMemo, type ReactNode } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export function FoundryTransport({
  children,
  includeProjects = false,
}: {
  children: ReactNode;
  includeProjects?: boolean;
}) {
  const { project } = useOrganizationTeamProject();
  const organizations = api.organization.getAll.useQuery(
    { isDemo: false },
    { enabled: includeProjects, staleTime: 60_000 },
  );
  const apiUtils = api.useUtils();

  const projects = useMemo<FoundryProject[]>(() => {
    if (!organizations.data) {
      return [];
    }

    return organizations.data.flatMap((organization) =>
      organization.teams.flatMap((team) =>
        team.projects.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          slug: candidate.slug,
          apiKey: candidate.apiKey,
          orgName: organization.name,
          teamName: team.name,
        })),
      ),
    );
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

  return (
    <FoundryRuntimeProvider transport={transport}>{children}</FoundryRuntimeProvider>
  );
}
