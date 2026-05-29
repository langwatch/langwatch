import { type Page } from "@playwright/test";

// Top-level route segments in langwatch/src/routes.tsx that are not a project
// slug. Anything else as the first path segment is treated as the slug.
const NON_PROJECT_SEGMENTS = new Set([
  "admin",
  "auth",
  "authorize",
  "cli",
  "governance",
  "invite",
  "mcp",
  "me",
  "onboarding",
  "ops",
  "settings",
  "share",
]);

/**
 * Derives the active project slug from the authenticated landing URL.
 *
 * The app root redirects to the signed-in landing (the personal portal's
 * project messages page), so the first path segment is the project slug. This
 * replaces reading the old sidebar "Home" link, which the personal portal
 * removed. Using the URL (set by the client router) rather than a sidebar link
 * keeps this independent of the trace backend that the landing page queries.
 */
export async function getProjectSlug(page: Page): Promise<string> {
  await page.goto("/");
  await page.waitForURL(
    (url) => {
      const segment = url.pathname.split("/").filter(Boolean)[0];
      return !!segment && !NON_PROJECT_SEGMENTS.has(segment);
    },
    { timeout: 30000 },
  );
  const slug = new URL(page.url()).pathname.split("/").filter(Boolean)[0] ?? "";
  if (!slug) {
    throw new Error(`Could not derive project slug from URL: ${page.url()}`);
  }
  return slug;
}
