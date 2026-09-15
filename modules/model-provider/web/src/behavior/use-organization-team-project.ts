/**
 * `useOrganizationTeamProject`, answered from the host port rather than the
 * application module of the same name a feature-web package cannot reach.
 * Nothing here fetches: it derives from readings the host already made,
 * rebuilding `availableScopes()`'s flat team/project lists into the nested
 * shape the editor's scope picker wants, rather than growing a second shape
 * on the port itself.
 */

import { useMemo } from "react";

import { useModelProviderHost } from "../model/model-provider-host.ts";

export type OrganizationTeamProjectReading = {
  organization:
    | {
        id: string;
        name: string;
        teams: {
          id: string;
          name: string;
          projects: { id: string; name: string }[];
        }[];
      }
    | undefined;
  team: { id: string; name: string } | undefined;
  project: { id: string; name: string; slug: string } | undefined;
  hasPermission: (permission: string) => boolean;
};

export function useOrganizationTeamProject(): OrganizationTeamProjectReading {
  const host = useModelProviderHost();
  const { teamId, projectId, projectSlug } = host.scope();
  const available = host.availableScopes();

  const organization = useMemo(() => {
    if (!available.organization) return void 0;
    return {
      id: available.organization.id,
      name: available.organization.name,
      teams: available.teams.map((team) => ({
        id: team.id,
        name: team.name,
        projects: available.projects
          .filter((project) => project.teamId === team.id)
          .map((project) => ({ id: project.id, name: project.name })),
      })),
    };
  }, [available]);

  const team = useMemo(
    () => available.teams.find((candidate) => candidate.id === teamId),
    [available.teams, teamId],
  );

  const project = useMemo(() => {
    const found = available.projects.find((candidate) => candidate.id === projectId);
    if (!found) return void 0;
    // The slug is the ADDRESS of the project and the flat list does not carry
    // it; the scope does, because it is the scope this page is about. A project
    // in the list that is not the one in scope therefore has no slug here,
    // which is correct: nothing addresses one.
    return { id: found.id, name: found.name, slug: projectSlug ?? "" };
  }, [available.projects, projectId, projectSlug]);

  // The identity has to be stable across renders: the editor form lists this
  // object's members in memo dependencies, and a fresh one per render re-fires
  // every one of them.
  return useMemo(
    () => ({
      organization,
      team,
      project,
      hasPermission: (permission: string) => host.hasPermission(permission),
    }),
    [organization, team, project, host],
  );
}
