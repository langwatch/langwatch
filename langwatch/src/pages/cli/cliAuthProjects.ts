/**
 * Project list + default selection for the CLI device-flow project-login
 * picker (`/cli/auth`, credential_type project_api_key).
 *
 * Project login mints a shared SDK API key, so the picker must never offer a
 * personal workspace project: a coding agent that picked (or had auto-picked)
 * one silently routed the user's evaluations to a personal project (customer
 * report). It also hides the internal_governance tenancy project, which is
 * never user-visible. The default selection prefers the last project the user
 * worked in (when it is one of the offered projects), then the sole project,
 * then nothing.
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
  projects?: ProjectLike[] | null;
}

export function resolveCliAuthProjects(args: {
  teams: TeamLike[] | null | undefined;
  lastProjectSlug?: string | null;
}): {
  projects: CliAuthProjectOption[];
  teams: CliAuthTeamOption[];
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

  // Only teams that actually have an offered project, so the grouped picker
  // never renders an empty team header.
  const offeredTeamIds = new Set(projects.map((p) => p.teamId));
  const teams = (args.teams ?? [])
    .filter((team) => offeredTeamIds.has(team.id))
    .map((team) => ({ id: team.id, name: team.name }));

  const lastProject = args.lastProjectSlug
    ? projects.find((p) => p.slug === args.lastProjectSlug)
    : undefined;

  const defaultProjectId =
    lastProject?.id ?? (projects.length === 1 ? projects[0]!.id : null);

  return { projects, teams, defaultProjectId };
}
