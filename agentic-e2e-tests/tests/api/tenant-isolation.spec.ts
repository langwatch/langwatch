import { test, expect } from "../support/fixtures";
import { provisionTenant } from "../support/tenant";
import { listOf } from "../support/api";

/**
 * The harness's own contract.
 *
 * If per-test provisioning breaks, every other headless test starts sharing
 * state again and the parallelism stops being safe — silently. These tests
 * exist so that failure is loud and lands here rather than as flakiness
 * somewhere else.
 *
 * Covers specs/ci/e2e-tiers.feature — "Each test owns its own organisation
 * and project".
 */

test.describe("Feature: headless test isolation", () => {
  test.describe("given a test that needs a project", () => {
    test("provisions its own organisation, project and API key", async ({
      tenant,
    }) => {
      expect(tenant.organizationId).toBeTruthy();
      expect(tenant.teamId).toBeTruthy();
      expect(tenant.projectId).toBeTruthy();
      expect(tenant.projectSlug).toBeTruthy();
      expect(tenant.apiKey).toBeTruthy();
    });

    test("the API key authenticates against the project API", async ({ api }) => {
      const datasets = await api.get("/api/dataset");
      expect(listOf(datasets)).toEqual([]);
    });
  });

  test.describe("when two tenants exist at once", () => {
    test("neither can see the other's data", async ({ request, api, tenant }) => {
      await api.post("/api/dataset", { name: "First tenant dataset" });

      // A second, fully independent tenant on its own request context, so it
      // carries its own session cookie rather than inheriting the first.
      const otherContext = await request.storageState().then(() => request);
      const other = await provisionTenant(otherContext, { label: "neighbour" });

      expect(other.projectId).not.toBe(tenant.projectId);
      expect(other.apiKey).not.toBe(tenant.apiKey);

      const otherDatasets = await request.get("/api/dataset", {
        headers: { "X-Auth-Token": other.apiKey },
      });
      expect(otherDatasets.ok()).toBe(true);
      expect(listOf(await otherDatasets.json())).toEqual([]);
    });
  });
});
