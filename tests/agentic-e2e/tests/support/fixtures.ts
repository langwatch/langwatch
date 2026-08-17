import { test as base, expect } from "@playwright/test";
import { ProjectApi } from "./api";
import { provisionTenant, type Tenant } from "./tenant";

/**
 * Fixtures for the headless tiers.
 *
 * Importing `test` from here rather than from `@playwright/test` gives a test
 * its own tenant and an API client bound to it. No browser is launched — these
 * fixtures only touch Playwright's `request` context, so the `api` and `cli`
 * projects run without one.
 *
 * See dev/docs/adr/010-e2e-testing-strategy.md (headless-tier amendment).
 */

type HeadlessFixtures = {
  tenant: Tenant;
  api: ProjectApi;
};

export const test = base.extend<HeadlessFixtures>({
  tenant: async ({ request }, use, testInfo) => {
    // The label lands in the seeded email address, so a leftover row in the
    // database points back at the test that created it.
    const label = testInfo.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);

    const tenant = await provisionTenant(request, { label: label || "test" });
    await use(tenant);
  },

  api: async ({ request, tenant }, use) => {
    await use(new ProjectApi(request, tenant));
  },
});

export { expect };
