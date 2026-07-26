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
    test("neither can see the other's data", async ({
      playwright,
      request,
      api,
      tenant,
      baseURL,
    }) => {
      const datasetName = `First tenant dataset ${Date.now()}`;
      await api.post("/api/dataset", { name: datasetName });

      // A genuinely separate context, so the second tenant signs in on its own
      // cookie jar instead of replacing the first's session. Reusing `request`
      // here would make this test pass for the wrong reason.
      const neighbourContext = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: {
          Origin: process.env.E2E_AUTH_ORIGIN ?? baseURL ?? "",
        },
      });

      try {
        const other = await provisionTenant(neighbourContext, {
          label: "neighbour",
        });

        expect(other.projectId).not.toBe(tenant.projectId);
        expect(other.apiKey).not.toBe(tenant.apiKey);

        // The neighbour sees an empty project...
        const neighbourDatasets = await neighbourContext.get("/api/dataset", {
          headers: { "X-Auth-Token": other.apiKey },
        });
        expect(neighbourDatasets.ok()).toBe(true);
        expect(listOf(await neighbourDatasets.json())).toEqual([]);

        // ...while the first tenant still sees its own, so the isolation is
        // mutual rather than the second tenant simply having nothing yet.
        const ownDatasets = listOf<{ name: string }>(
          await request.get("/api/dataset", {
            headers: { "X-Auth-Token": tenant.apiKey },
          }).then((response) => response.json()),
        );
        expect(ownDatasets.map((dataset) => dataset.name)).toContain(datasetName);
      } finally {
        await neighbourContext.dispose();
      }
    });
  });
});
