/**
 * The organization graph the welcome redirect and the legacy project key
 * read off — this family's own borrowed `organization.getAll` query, kept
 * to one hook since both are read together on every onboarding screen.
 */

import type { TimeInput } from "@langwatch/time";
import { useMemo } from "react";

import type { OnboardingOrganization, OnboardingTeam } from "../model/onboarding-host.ts";
import { onboardingApi } from "./onboarding-api.ts";

type GraphProject = {
  id: string;
  name: string;
  slug: string;
  apiKey?: string | null;
  createdAt?: TimeInput | null;
};
type GraphTeam = {
  id: string;
  name: string;
  isPersonal?: boolean | null;
  projects: GraphProject[];
};
type GraphOrganization = {
  id: string;
  name: string;
  primaryIntent: string | null;
  signupData?: unknown;
  teams: GraphTeam[];
};

/** The one place this family narrows the borrowed procedure's `unknown` output. */
function asOrganizationGraph(data: unknown): GraphOrganization[] | undefined {
  return data as GraphOrganization[] | undefined;
}

function toHostTeams(entry: GraphOrganization): OnboardingTeam[] {
  return entry.teams.map((team) => ({
    id: team.id,
    name: team.name,
    isPersonal: team.isPersonal ?? false,
    projects: team.projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      createdAt: project.createdAt ?? null,
    })),
  }));
}

function toHostOrganization(entry: GraphOrganization): OnboardingOrganization {
  return {
    id: entry.id,
    name: entry.name,
    primaryIntent: entry.primaryIntent,
    signupData: entry.signupData,
    teams: toHostTeams(entry),
  };
}

export type OnboardingActiveProject = { project: GraphProject; teamId: string };

export type OnboardingOrganizationGraph = {
  organization: OnboardingOrganization | undefined;
  organizations: readonly OnboardingOrganization[] | undefined;
  activeProject: OnboardingActiveProject | undefined;
  /**
   * The base key of any project in the graph, as the server redacted it: the
   * empty string it sends a reader who may not manage the project reads as absent.
   */
  projectApiKey: (projectId: string) => string | undefined;
  isLoading: boolean;
};

function apiKeysByProject(graph: GraphOrganization[] | undefined): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  for (const organization of graph ?? []) {
    for (const team of organization.teams) {
      for (const project of team.projects) {
        if (project.apiKey) keys.set(project.id, project.apiKey);
      }
    }
  }
  return keys;
}

function findActiveProject(
  organization: GraphOrganization | undefined,
  projectId: string | undefined,
): OnboardingActiveProject | undefined {
  if (!projectId) return void 0;
  for (const team of organization?.teams ?? []) {
    const project = team.projects.find((candidate) => candidate.id === projectId);
    if (project) return { project, teamId: team.id };
  }
  return void 0;
}

export function useOnboardingOrganizationGraph(input: {
  organizationId: string | undefined;
  projectId: string | undefined;
}): OnboardingOrganizationGraph {
  const graphQuery = onboardingApi.organization.getAll.useQuery({ isDemo: false });
  const graph = asOrganizationGraph(graphQuery.data);

  return useMemo(() => {
    const rawOrganization = graph?.find((candidate) => candidate.id === input.organizationId);
    const apiKeys = apiKeysByProject(graph);
    return {
      organization: rawOrganization ? toHostOrganization(rawOrganization) : void 0,
      organizations: graph?.map(toHostOrganization),
      activeProject: findActiveProject(rawOrganization, input.projectId),
      projectApiKey: (projectId: string) => apiKeys.get(projectId),
      isLoading: graphQuery.isLoading,
    };
  }, [graph, graphQuery.isLoading, input.organizationId, input.projectId]);
}
