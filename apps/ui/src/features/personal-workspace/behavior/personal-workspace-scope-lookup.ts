/**
 * Which organization and project the personal workspace address is about.
 *
 * Both resolved out of the graph already in hand rather than asked for again:
 * every organization the reader can reach is already on the page, so finding
 * the one (and the project) the scope names is a lookup, not a fetch.
 */
import type {
  PersonalOrganization,
  PersonalProject,
} from "@langwatch/user-web/screens/personal-workspace";

export function resolvePersonalWorkspaceOrganization({
  organizationId,
  organizations,
}: {
  organizationId: string | null;
  organizations: readonly PersonalOrganization[];
}): PersonalOrganization | undefined {
  if (!organizationId) return void 0;
  return organizations.find((candidate) => candidate.id === organizationId);
}

/**
 * The project the address is about, found anywhere in the graph, under
 * whichever team holds it.
 */
export function resolvePersonalWorkspaceProject({
  projectId,
  organizations,
}: {
  projectId: string | null;
  organizations: readonly PersonalOrganization[];
}): PersonalProject | undefined {
  if (!projectId) return void 0;
  for (const organization of organizations) {
    for (const team of organization.teams) {
      const project = team.projects.find((candidate) => candidate.id === projectId);
      if (project) return project;
    }
  }
  return void 0;
}
