import { getProjectSlug } from "./helpers";
import { test, expect } from "./test.ts";

/**
 * Smoke tests: basic sanity checks after auth setup, verifying
 * infrastructure works, not user behavior.
 */

test("app loads after authentication", async ({ page }) => {
  // Derive a real project deterministically, independent of persona-based root
  // routing (a personal-persona user lands on /coding-agents, not a project route).
  const slug = await getProjectSlug(page);

  await page.goto(`/${slug}/messages`);

  // Verify we're not bounced to login and the authenticated shell renders.
  await expect(page).not.toHaveURL(/\/auth\/signin/);
  // From a project the entry opens the project's settings (settings-shell-v2.feature).
  await expect(page.getByRole("link", { name: "Settings", exact: true }).first()).toBeVisible({
    timeout: 30000,
  });
});
