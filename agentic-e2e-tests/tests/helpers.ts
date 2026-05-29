import { type Page } from "@playwright/test";

type GetAllResponse = {
  "0"?: {
    result?: {
      data?: {
        json?: Array<{
          teams?: Array<{ projects?: Array<{ slug?: string }> }>;
        }>;
      };
    };
  };
};

/**
 * Derives a project slug for the authenticated test user.
 *
 * Reads it from organization.getAll (the same API auth.setup uses to provision
 * the org and project) rather than from the app-root redirect. The root landing
 * is persona-dependent: a user whose persona resolves to personal lands on /me,
 * not a project route, so deriving the slug from the URL was non-deterministic
 * across runs (and 404s when the governance flag gating /me is off). The API is
 * authoritative regardless of persona.
 */
export async function getProjectSlug(page: Page): Promise<string> {
  const response = await page.request.get(
    "/api/trpc/organization.getAll?batch=1&input=" +
      encodeURIComponent(JSON.stringify({ "0": { json: {} } })),
  );
  const data = (await response.json().catch(() => null)) as GetAllResponse | null;
  const orgs = data?.["0"]?.result?.data?.json ?? [];
  for (const org of orgs) {
    for (const team of org.teams ?? []) {
      const slug = (team.projects ?? [])[0]?.slug;
      if (slug) {
        return slug;
      }
    }
  }
  throw new Error(
    `Could not derive a project slug from organization.getAll (status ${response.status()})`,
  );
}
