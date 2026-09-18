/**
 * The organization graph the host reads its teams-and-projects reading off —
 * this family's own `organization.getAll` query, the shell's shared cache key.
 */

import { useMemo } from "react";

import type {
  OrganizationProjectReading,
  OrganizationReading,
} from "../model/organization-host.ts";
import { organizationApi } from "./organization-api.ts";

export type OrganizationActiveProject = { project: OrganizationProjectReading; teamId: string };

export type OrganizationGraph = {
  organization: OrganizationReading | undefined;
  activeProject: OrganizationActiveProject | undefined;
};

function findActiveProject(
  organization: OrganizationReading | undefined,
  projectId: string | undefined,
): OrganizationActiveProject | undefined {
  if (!projectId) return void 0;
  for (const team of organization?.teams ?? []) {
    const project = team.projects.find((candidate) => candidate.id === projectId);
    if (project) return { project, teamId: team.id };
  }
  return void 0;
}

export function useOrganizationGraph(input: {
  organizationId: string | undefined;
  projectId: string | undefined;
}): OrganizationGraph {
  const graphQuery = organizationApi.organization.getAll.useQuery({ isDemo: false });

  return useMemo(() => {
    const organization = graphQuery.data?.find(
      (candidate) => candidate.id === input.organizationId,
    );
    return { organization, activeProject: findActiveProject(organization, input.projectId) };
  }, [graphQuery.data, input.organizationId, input.projectId]);
}
