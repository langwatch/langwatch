/**
 * The workspace graph as the chrome reads it: `organization.getAll` narrowed
 * to the navigation port's vocabulary, plus the two lookups made against the
 * raw read, whose fields the narrowing drops.
 */

import type {
  NavigationOrganization,
  NavigationTeam,
} from "@langwatch/navigation-browser/navigation";

import { selectAmbientTeam, userCanOpenTeam } from "../behavior/ui-scope-resolution";

/** `organization.getAll` as it arrives, including what only presence reads. */
export type NavigationGraphRead = readonly {
  id: string;
  name: string;
  /** The organization-wide presence kill switch; absent means never read. */
  presenceEnabled?: boolean;
  members?: { role: string }[];
  teams: {
    id: string;
    name: string;
    isPersonal?: boolean | null;
    ownerUserId?: string | null;
    members?: { userId: string }[];
    projects: {
      id: string;
      name: string;
      slug: string;
      presenceEnabled?: boolean;
      lastCodingAgentSessionAt?: string | null;
      lastCodingAgentPullRequestAt?: string | null;
    }[];
  }[];
}[];

/** The two switches the account menu's presence row reads. */
export type NavigationPresenceFlags = {
  organizationPresenceEnabled?: boolean | undefined;
  projectPresenceEnabled?: boolean | undefined;
};

/** The graph in the navigation package's vocabulary, unused fields dropped. */
export function toNavigationOrganizations(read: NavigationGraphRead): NavigationOrganization[] {
  return read.map((organization) => ({
    id: organization.id,
    name: organization.name,
    teams: organization.teams.map((team) => ({
      id: team.id,
      name: team.name,
      isPersonal: team.isPersonal,
      ownerUserId: team.ownerUserId,
      members: team.members,
      projects: team.projects.map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        isPersonal: team.isPersonal,
        lastCodingAgentSessionAt: project.lastCodingAgentSessionAt,
        lastCodingAgentPullRequestAt: project.lastCodingAgentPullRequestAt,
      })),
    })),
  }));
}

/**
 * The team a project sits in — where the chrome's personal-workspace test
 * and the cross-scope banner both read from.
 */
export function teamHoldingProject(
  graph: readonly NavigationOrganization[],
  projectId: string | null,
): NavigationTeam | undefined {
  if (!projectId) return void 0;
  for (const organization of graph) {
    const holder = organization.teams.find((team) =>
      team.projects.some((project) => project.id === projectId),
    );
    if (holder) return holder;
  }
  return void 0;
}

/**
 * The teams this reader may open, in the order the shell resolves an ambient
 * one: the ambient team first, then the rest of what they can reach.
 */
export function openableTeamsOf({
  organization,
  userId,
  organizationRole,
}: {
  organization: NavigationOrganization | undefined;
  userId: string | undefined;
  organizationRole: string | undefined;
}): readonly NavigationTeam[] {
  const reachable = (organization?.teams ?? []).filter((team) =>
    userCanOpenTeam({ team, userId, organizationRole }),
  );
  const ambient = selectAmbientTeam({ teams: reachable, userId });
  if (!ambient) return reachable;
  return [ambient, ...reachable.filter((team) => team.id !== ambient.id)];
}

/** The presence switches, read off the raw graph the narrowing dropped them from. */
export function presenceFlagsOf({
  read,
  organizationId,
  projectId,
}: {
  read: NavigationGraphRead;
  organizationId: string | null;
  projectId: string | null;
}): NavigationPresenceFlags {
  const organization = read.find((candidate) => candidate.id === organizationId);
  const project = organization?.teams
    .flatMap((team) => team.projects)
    .find((candidate) => candidate.id === projectId);
  return {
    organizationPresenceEnabled: organization?.presenceEnabled,
    projectPresenceEnabled: project?.presenceEnabled,
  };
}
