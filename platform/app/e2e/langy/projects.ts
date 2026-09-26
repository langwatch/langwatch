/**
 * Scratch-project creation for scenarios that need to compare Langy's
 * behavior across DIFFERENT telemetry states within one project (a project
 * with no traces, one with broken spans, one with good spans). Every other
 * suite in this folder runs against the single seeded `PROJECT_ID`
 * (config.ts) because one project state is enough; the how-do-i-latency
 * suite is the first to need several projects at once, since "no traces
 * exist" and "traces exist but are broken" cannot both be true of the same
 * project at the same time.
 *
 * Goes through the same tRPC mutations the "new project" UI flow calls
 * (`organization.getAll` to find where the caller can create, then
 * `project.create`), authenticated as the same admin session cookie every
 * other tRPC call in this suite uses (`trpc.ts`). `project.create` only
 * returns `{ success, projectSlug }` — no id, no key — so the id and the
 * project's own API key (needed to seed traces into it and to point a
 * `makeLangyAdapter({ projectId })` at it) are read back from a second
 * `organization.getAll`, whose `teams[].projects[]` carries the full Project
 * row (id, slug, apiKey) with no `select` narrowing it.
 *
 * Projects created here are NEVER deleted: `project.archive` exists but
 * archiving is a bigger behavioral surface to pull into a scenario suite than
 * this needs, and a local/staging stack's project count is not a scarce
 * resource. See e2e/langy/README.md for the one risk this carries (a plan
 * limit on project count could eventually make this suite fail on repeated
 * runs against a shared stack).
 */

import { getSessionCookie, trpcMutate, trpcQuery } from "./trpc";

interface OrgProject {
  id: string;
  slug: string;
  apiKey: string;
}
interface OrgTeam {
  id: string;
  isPersonal?: boolean;
  projects: OrgProject[];
}
interface Org {
  id: string;
  teams: OrgTeam[];
}

async function getOrganizations(cookie: string): Promise<Org[]> {
  const organizations = await trpcQuery<Org[]>({
    cookie,
    path: "organization.getAll",
    input: {},
  });
  return organizations;
}

/** A newly created scratch project, ready to seed traces into and to point a `makeLangyAdapter` at. */
export interface ScratchProject {
  projectId: string;
  apiKey: string;
  slug: string;
}

/**
 * Creates a fresh, empty project owned by the same organization/team the
 * suite's admin session already belongs to, and returns its id + API key.
 *
 * `name` is given a timestamp suffix by the caller (see the how-do-i-latency
 * suite's `how-do-i-<state>-<timestamp>` naming) so repeated local runs never
 * collide on the team-scoped slug uniqueness check in `project.create`.
 */
export async function createScratchProject(
  name: string,
): Promise<ScratchProject> {
  const cookie = await getSessionCookie();
  const organizations = await getOrganizations(cookie);
  const organization = organizations[0];
  if (!organization) {
    throw new Error(
      "createScratchProject: the test admin belongs to no organization",
    );
  }
  const team =
    organization.teams.find((t) => !t.isPersonal) ?? organization.teams[0];
  if (!team) {
    throw new Error(
      `createScratchProject: organization ${organization.id} has no team to create into`,
    );
  }

  const { projectSlug } = await trpcMutate<{
    success: boolean;
    projectSlug: string;
  }>({
    cookie,
    path: "project.create",
    input: {
      organizationId: organization.id,
      teamId: team.id,
      name,
      language: "other",
      framework: "other",
    },
  });

  // project.create answers with the slug alone; re-read the org to get the
  // id + apiKey the rest of this suite needs (see file header).
  const afterCreate = await getOrganizations(cookie);
  for (const org of afterCreate) {
    for (const t of org.teams) {
      const project = t.projects.find((p) => p.slug === projectSlug);
      if (project) {
        return {
          projectId: project.id,
          apiKey: project.apiKey,
          slug: project.slug,
        };
      }
    }
  }
  throw new Error(
    `createScratchProject: created project "${projectSlug}" but could not find it in organization.getAll afterwards`,
  );
}
