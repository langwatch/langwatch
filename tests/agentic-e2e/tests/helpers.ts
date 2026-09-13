import { type Page } from "@playwright/test";

type ProjectRef = { id?: string; slug?: string };

type GetAllResponse = {
  "0"?: {
    result?: {
      data?: {
        json?: Array<{
          teams?: Array<{ projects?: ProjectRef[] }>;
        }>;
      };
    };
  };
};

/**
 * A project id the app minted is `project_<base62>`, and that `project` prefix
 * is on the redaction allowlist (packages/redaction/src/secrets.ts,
 * RECORD_ID_PREFIXES). A legacy or seeded id like `local-dev-project` is not,
 * so the `/api/files/<projectId>/so_...` URL the media player builds from it is
 * rewritten to `[SECRET]` by the `shaped_api_key` rule, 404s, and the audio
 * never renders. Preferring a production-shaped project is what keeps those
 * file URLs intact — see the voice contract spec's media-in-traces assertion.
 */
function isProductionShapedId(id: string | undefined): id is string {
  return typeof id === "string" && id.startsWith("project_");
}

/**
 * Derives a project slug for the authenticated test user.
 *
 * Reads it from organization.getAll (the same API auth.setup uses to provision
 * the org and project) rather than from the app-root redirect. The root landing
 * is persona-dependent: a user whose persona resolves to personal lands on /me,
 * not a project route, so deriving the slug from the URL was non-deterministic
 * across runs (and 404s when the governance flag gating /me is off). The API is
 * authoritative regardless of persona.
 *
 * Prefers a project whose id is production-shaped (`project_...`) over any
 * legacy/seeded id (e.g. `local-dev-project`), so the run's stored-object file
 * URLs survive secret redaction (see {@link isProductionShapedId}). Falls back
 * to the first project with a slug when none is production-shaped, preserving
 * the prior behavior rather than failing a suite that has only a legacy project.
 *
 * `E2E_PROJECT_SLUG` names one project instead, for a local run against a
 * project of your choice, for example a fresh one with no data. Do not point it
 * at a legacy-id project (e.g. `local-dev-project`) for the voice suite — its
 * media URLs will not survive redaction.
 */
export async function getProjectSlug(page: Page): Promise<string> {
  const pinned = process.env.E2E_PROJECT_SLUG;
  if (pinned) return pinned;

  const response = await page.request.get(
    "/api/trpc/organization.getAll?batch=1&input=" +
      encodeURIComponent(JSON.stringify({ "0": { json: {} } })),
  );
  const data = (await response.json().catch(() => null)) as GetAllResponse | null;
  const orgs = data?.["0"]?.result?.data?.json ?? [];
  const projects = orgs
    .flatMap((org) => org.teams ?? [])
    .flatMap((team) => team.projects ?? []);

  const productionShaped = projects.find(
    (project) => isProductionShapedId(project.id) && project.slug,
  );
  if (productionShaped?.slug) return productionShaped.slug;

  const anyWithSlug = projects.find((project) => project.slug);
  if (anyWithSlug?.slug) return anyWithSlug.slug;

  throw new Error(
    `Could not derive a project slug from organization.getAll (status ${response.status()})`,
  );
}
