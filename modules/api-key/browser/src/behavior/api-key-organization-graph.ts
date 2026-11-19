/**
 * The organization graph these two hosts read scope, names and the legacy
 * project key off — one query, shared by both, since both mount over the
 * same `apiKeyApi` provider and cache entry.
 */

import { useUiHostServices } from "@langwatch/browser-host/capabilities";

import { availableScopesOf } from "../model/api-key-available-scopes.ts";
import type {
  ApiKeyAvailableScopes,
  ApiKeyOrganization,
  ApiKeyOrganizationTeam,
} from "../model/api-key-host.ts";
import { apiKeyApi } from "./api-key-api.ts";

type GraphProject = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean | null;
  ownerUserId?: string | null;
  kind?: string | null;
};

type GraphTeam = {
  id: string;
  name: string;
  isPersonal?: boolean | null;
  ownerUserId?: string | null;
  projects: GraphProject[];
};

type GraphOrganization = { id: string; name: string; teams: GraphTeam[] };

/** The one place this family narrows the borrowed procedure's `unknown` output. */
function asOrganizationGraph(data: unknown): GraphOrganization[] | undefined {
  return data as GraphOrganization[] | undefined;
}

function toHostTeams(entry: GraphOrganization): ApiKeyOrganizationTeam[] {
  return entry.teams.map((team) => ({
    id: team.id,
    name: team.name,
    isPersonal: team.isPersonal,
    ownerUserId: team.ownerUserId,
    projects: team.projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      isPersonal: project.isPersonal,
      ownerUserId: project.ownerUserId,
      kind: project.kind,
    })),
  }));
}

export type ApiKeyActiveProject = { project: GraphProject; teamId: string };

export type ApiKeyOrganizationGraph = {
  organization: GraphOrganization | undefined;
  activeProject: ApiKeyActiveProject | undefined;
  availableScopes: ApiKeyAvailableScopes;
  hostOrganizations: ApiKeyOrganization[] | undefined;
};

function findActiveProject(
  organization: GraphOrganization | undefined,
  projectId: string | undefined,
): ApiKeyActiveProject | undefined {
  if (!projectId) return void 0;
  for (const team of organization?.teams ?? []) {
    const project = team.projects.find((candidate) => candidate.id === projectId);
    if (project) return { project, teamId: team.id };
  }
  return void 0;
}

/** The graph both `ApiKeyHostApi` and `AuthorizeHostApi` read scope and the legacy key off. */
export function useApiKeyOrganizationGraph(input: {
  organizationId: string | undefined;
  projectId: string | undefined;
}): ApiKeyOrganizationGraph {
  const { session } = useUiHostServices();
  const graphQuery = apiKeyApi.organization.getAll.useQuery(
    { isDemo: false },
    { enabled: !!session.currentUser() },
  );
  const graph = asOrganizationGraph(graphQuery.data);
  const viewerUserId = session.currentUser()?.id;

  const organization = graph?.find((candidate) => candidate.id === input.organizationId);
  const activeProject = findActiveProject(organization, input.projectId);
  const availableScopes = availableScopesOf({ organization, viewerUserId });
  const hostOrganizations = graph?.map((entry) => ({
    id: entry.id,
    name: entry.name,
    teams: toHostTeams(entry),
  }));
  return { organization, activeProject, availableScopes, hostOrganizations };
}
