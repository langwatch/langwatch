/**
 * Project list + default selection for the CLI device-flow project-login
 * picker (`/cli/auth`, credential_type project_api_key).
 *
 * Project login hands the CLI a project's API key, so the picker offers:
 *
 *   - the org's shared projects, grouped under their teams (the internal
 *     internal_governance tenancy project is never user-visible), and
 *   - the caller's OWN personal workspace project as a separate, explicit
 *     "Personal" entry. Explicit is the point: the historical hazard was a
 *     coding agent silently AUTO-selecting a personal project and routing a
 *     team's evaluations there (customer report), so personal is never
 *     implied by any other selection; picking it is a deliberate act, and
 *     the server (`/api/auth/cli/approve`) only honours the caller's own.
 *
 * The default selection prefers the last project the user worked in (when
 * offered), then the sole shared project, then, when the org has no shared
 * projects at all, the personal project, so a fresh solo user is never
 * dead-ended on an empty picker.
 */

export interface CliAuthProjectOption {
  id: string;
  name: string;
  slug: string;
  teamId: string;
  teamName: string;
}

export interface CliAuthTeamOption {
  id: string;
  name: string;
}

interface ProjectLike {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean | null;
  kind?: string | null;
}

interface TeamLike {
  id: string;
  name: string;
  isPersonal?: boolean | null;
  projects?: ProjectLike[] | null;
}

/** The group label the personal entry renders under in the picker. */
export const PERSONAL_GROUP_NAME = "Personal";

export function resolveCliAuthProjects(args: {
  teams: TeamLike[] | null | undefined;
  lastProjectSlug?: string | null;
}): {
  projects: CliAuthProjectOption[];
  teams: CliAuthTeamOption[];
  /** The caller's own personal workspace project, when one exists. The org
   *  payload only ever carries the caller's own personal team (other
   *  members' personal workspaces are private), so first match is it. */
  personalProject: CliAuthProjectOption | null;
  defaultProjectId: string | null;
} {
  const projects = (args.teams ?? []).flatMap((team) =>
    (team.projects ?? [])
      .filter((p) => !p.isPersonal && p.kind !== "internal_governance")
      .map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        teamId: team.id,
        teamName: team.name,
      })),
  );

  const personalProject = (args.teams ?? []).reduce<CliAuthProjectOption | null>(
    (found, team) => {
      if (found) return found;
      const personal = (team.projects ?? []).find(
        (p) => p.isPersonal && p.kind !== "internal_governance",
      );
      return personal
        ? {
            id: personal.id,
            name: personal.name,
            slug: personal.slug,
            teamId: team.id,
            teamName: PERSONAL_GROUP_NAME,
          }
        : null;
    },
    null,
  );

  // Only teams that actually have an offered project, so the grouped picker
  // never renders an empty team header. The personal entry brings its own
  // "Personal" group.
  const offeredTeamIds = new Set(projects.map((p) => p.teamId));
  const teams: CliAuthTeamOption[] = (args.teams ?? [])
    .filter((team) => offeredTeamIds.has(team.id))
    .map((team) => ({ id: team.id, name: team.name }));
  if (personalProject) {
    teams.push({ id: personalProject.teamId, name: PERSONAL_GROUP_NAME });
  }

  const lastProject = args.lastProjectSlug
    ? projects.find((p) => p.slug === args.lastProjectSlug)
    : undefined;

  const defaultProjectId =
    lastProject?.id ??
    (projects.length === 1
      ? projects[0]!.id
      : // No shared projects at all: the personal project is the only sane
        // target, so preselect it rather than dead-ending the user.
        projects.length === 0
        ? (personalProject?.id ?? null)
        : null);

  return { projects, teams, personalProject, defaultProjectId };
}
