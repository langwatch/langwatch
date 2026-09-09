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
 * The personal entry is matched by the PROJECT's `ownerUserId ===
 * currentUserId`, the same predicate `/api/auth/cli/approve` authorizes with,
 * never by "first personal team in the payload". `organization.getAll`
 * retains EVERY team for an org admin, including OTHER members' personal
 * workspaces; without the owner filter an admin in a shared-project-less org
 * would see a colleague's workspace preselected and labelled "Personal", and
 * approval would then fail server-side with `personal_project_not_allowed`.
 * The caller's id must be passed for the personal entry to resolve at all.
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
  ownerUserId?: string | null;
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

/**
 * The CALLER's own personal workspace, matched on the PROJECT's ownerUserId:
 * the exact field the approve endpoint authorizes against, so the picker can
 * never offer an entry the server would refuse. An admin's payload can carry
 * other members' personal workspaces too; those never match.
 */
function findOwnPersonalProject(
  teams: TeamLike[],
  currentUserId: string,
): CliAuthProjectOption | null {
  for (const team of teams) {
    const personal = (team.projects ?? []).find(
      (p) => p.isPersonal && p.ownerUserId === currentUserId && p.kind !== "internal_governance",
    );
    if (personal) {
      return {
        id: personal.id,
        name: personal.name,
        slug: personal.slug,
        teamId: team.id,
        teamName: PERSONAL_GROUP_NAME,
      };
    }
  }
  return null;
}

/**
 * The project the picker starts on: the last project the user worked in when
 * it is one of the offered ones, then the sole shared project, then, where the
 * org has no shared projects at all, the personal one, so a fresh solo user is
 * never dead-ended on an empty picker.
 */
function pickDefaultProjectId(args: {
  projects: CliAuthProjectOption[];
  lastProjectSlug?: string | null;
  personalProject: CliAuthProjectOption | null;
}): string | null {
  const lastProject = args.lastProjectSlug
    ? args.projects.find((p) => p.slug === args.lastProjectSlug)
    : undefined;
  if (lastProject) return lastProject.id;
  if (args.projects.length === 1) return args.projects[0]!.id;
  if (args.projects.length === 0) return args.personalProject?.id ?? null;
  return null;
}

export function resolveCliAuthProjects(args: {
  teams: TeamLike[] | null | undefined;
  lastProjectSlug?: string | null;
  /** The signed-in user's id. Required to resolve the personal entry: only a
   *  personal team OWNED by this user is offered as "Personal". Absent (or no
   *  match) means no personal entry is shown, which is correct: a picker with
   *  no known caller must not guess someone's workspace. */
  currentUserId?: string | null;
}): {
  projects: CliAuthProjectOption[];
  teams: CliAuthTeamOption[];
  /** The caller's own personal workspace project, when one exists: the
   *  project whose `ownerUserId` is the caller. An admin's payload can carry
   *  other members' personal workspaces too; those never match. */
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

  // Without a caller id, no personal entry is shown (never guess a
  // stranger's workspace).
  const personalProject = args.currentUserId
    ? findOwnPersonalProject(args.teams ?? [], args.currentUserId)
    : null;

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

  const defaultProjectId = pickDefaultProjectId({
    projects,
    lastProjectSlug: args.lastProjectSlug,
    personalProject,
  });

  return { projects, teams, personalProject, defaultProjectId };
}
