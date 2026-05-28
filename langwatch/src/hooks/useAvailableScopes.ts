import { useMemo } from "react";
import type { AvailableScopes } from "~/components/settings/ScopeFilter";

/**
 * Derives the available-scopes payload (`{ organization, teams, projects }`)
 * from the organization graph returned by `useOrganizationTeamProject`.
 *
 * Shared between the model-providers and api-keys settings pages so
 * neither contains an inline `useMemo` replicating the org/team/project
 * derivation.
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
): AvailableScopes {
  return useMemo(() => {
    const teams = organization?.teams ?? [];
    return {
      organization: organization
        ? { id: organization.id, name: organization.name }
        : null,
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
      projects: teams.flatMap((t) =>
        (t.projects ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          teamId: t.id,
        })),
      ),
    };
  }, [organization]);
}
