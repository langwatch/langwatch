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
 * Derives a project slug via organization.getAll, not the app-root
 * redirect — a personal-persona user lands on /me, making a URL-derived
 * slug non-deterministic. `E2E_PROJECT_SLUG` pins one for local runs.
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
