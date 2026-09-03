/**
 * `useOrganizationTeamProject`, answered from the host port.
 *
 * The recovered provider editor asks for the tenant the way every
 * `platform/app` component did: one hook returning the organization, the team
 * and the project, plus a permission probe. That hook was an application module
 * — it read the session, the router and the organization graph — and none of
 * those may be reached from a feature-web package.
 *
 * NOTHING HERE FETCHES. The scope and the visible scopes are readings the host
 * has already made, so this is a derivation over them and not a second source
 * of truth. Named after the hook it replaces so the call sites keep reading
 * `const { project, organization } = useOrganizationTeamProject()`.
 *
 * THE GRAPH IS RECONSTRUCTED, NOT RE-READ. `availableScopes()` is a flat list
 * of teams and a flat list of projects carrying their `teamId`, which is the
 * shape the providers table wanted; the editor's scope picker wants them
 * nested. Rebuilding the nesting here is one pass over data already in memory,
 * and it keeps the port from growing a second shape of the same answer.
 */

import { useMemo } from "react";

import { useModelProviderHost } from "../model/model-provider-host";

export type OrganizationTeamProjectReading = {
  organization:
    | {
        id: string;
        name: string;
        teams: Array<{
          id: string;
          name: string;
          projects: Array<{ id: string; name: string }>;
        }>;
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
