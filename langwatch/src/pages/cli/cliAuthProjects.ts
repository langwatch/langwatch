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
  teamName: string;
}

interface ProjectLike {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean | null;
  kind?: string | null;
}

interface TeamLike {
  name: string;
  projects?: ProjectLike[] | null;
}

export function resolveCliAuthProjects(args: {
  teams: TeamLike[] | null | undefined;
  lastProjectSlug?: string | null;
}): { projects: CliAuthProjectOption[]; defaultProjectId: string | null } {
  const projects = (args.teams ?? []).flatMap((team) =>
    (team.projects ?? [])
      .filter((p) => !p.isPersonal && p.kind !== "internal_governance")
      .map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        teamName: team.name,
      })),
  );

  const lastProject = args.lastProjectSlug
    ? projects.find((p) => p.slug === args.lastProjectSlug)
    : undefined;

  const defaultProjectId =
    lastProject?.id ?? (projects.length === 1 ? projects[0]!.id : null);

  return { projects, defaultProjectId };
}
