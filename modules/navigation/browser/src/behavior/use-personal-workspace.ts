import { useNavigationHost } from "../model/navigation-host.ts";
import { isOwnPersonalTeam } from "../model/personal-team.ts";
import { navigationApi, type NavigationApiMap } from "./navigation-api.ts";

/**
 * The advanced features a reader turned on in their personal workspace:
 * default-empty storage means an existing reader sees Traces only, until
 * the bundle checkbox in `/me/configure` flips them on atomically.
 */
export type PersonalWorkspaceFeatures =
  NavigationApiMap["personalWorkspaceFeatures"]["get"]["query"]["output"];

/** The reader's own personal project in the ambient organization, as the host reads it. */
export function usePersonalProject(): { id: string; slug: string } | null {
  // Own team only (main's findPersonalProject): an admin also sees members' personal teams.
  const host = useNavigationHost();
  const userId = host.currentUser()?.id;

  return (
    host.openableTeams().find((team) => isOwnPersonalTeam(team, userId) && !!team.projects[0])
      ?.projects[0] ?? null
  );
}

/** The personal project's slug and the advanced features turned on in it. */
export function usePersonalWorkspace(): {
  personalProjectSlug: string | null;
  features: PersonalWorkspaceFeatures | undefined;
} {
  const personalProject = usePersonalProject();
  const personalProjectId = personalProject?.id ?? null;
  const featuresQuery = navigationApi.personalWorkspaceFeatures.get.useQuery(
    { projectId: personalProjectId ?? "" },
    { enabled: !!personalProjectId, refetchOnWindowFocus: false },
  );

  return {
    personalProjectSlug: personalProject?.slug ?? null,
    features: featuresQuery.data,
  };
}
