import { useMemo } from "react";
import type { ScopeHierarchy } from "~/utils/filterProvidersByScope";

/**
 * The set of scopes available for the scope filter dropdown.
 * Owned here (canonical definition) — ScopeFilter.tsx imports this type.
 */
export interface AvailableScopes {
  organization?: { id: string; name: string } | null;
  teams: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; teamId?: string | null }>;
}

/**
 * Derives the available-scopes payload (`{ organization, teams, projects, hierarchy }`)
 * from the organization graph returned by `useOrganizationTeamProject`.
 *
 * Shared between the model-providers and api-keys settings pages so
 * neither contains an inline `useMemo` replicating the org/team/project
 * derivation.
 *
 * `hierarchy` is the `ScopeHierarchy` shape consumed by `filterProvidersByScope`.
 * Colocated here so neither page builds it with a duplicate `useMemo`.
 *
 * @param organization - The organization object from `useOrganizationTeamProject`
 */
export function useAvailableScopes(
  organization:
    | {
        id: string;
        name: string;
        teams: Array<{
          id: string;
          name: string;
          projects?: Array<{ id: string; name: string }> | null;
        }>;
      }
    | null
    | undefined,
): AvailableScopes & { hierarchy: ScopeHierarchy } {
  return useMemo(() => {
    const teams = organization?.teams ?? [];
    const availableTeams = teams.map((t) => ({ id: t.id, name: t.name }));
    const availableProjects = teams.flatMap((t) =>
      (t.projects ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        teamId: t.id,
      })),
    );
    return {
      organization: organization
        ? { id: organization.id, name: organization.name }
        : null,
      teams: availableTeams,
      projects: availableProjects,
      hierarchy: {
        organization: organization ? { id: organization.id } : null,
        teams: availableTeams.map((t) => ({ id: t.id })),
        projects: availableProjects.map((p) => ({
          id: p.id,
          teamId: p.teamId,
        })),
      },
    };
  }, [organization]);
}
