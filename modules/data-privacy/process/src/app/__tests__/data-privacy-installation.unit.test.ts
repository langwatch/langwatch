import type { AuthzApi } from "@langwatch/authz-contract";
import { DataPrivacyApi, PLATFORM_DEFAULT_DATA_PRIVACY } from "@langwatch/data-privacy-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { DataPrivacyModule } from "../../app/data-privacy.app.ts";
import { dataPrivacyProcessModule } from "../../data-privacy.module.ts";
import {
  dataPrivacyTestEventing,
  projectFactOwner,
} from "../../eventing/__tests__/data-privacy-project-scope.fixture.ts";
import {
  dataPrivacyTestGraph,
  dataPrivacyTestSecrets,
  foldDataPrivacyTestProject,
} from "./data-privacy.fixture.ts";

const PROJECT_ID = dataPrivacyTestGraph.projectId;
const ORGANIZATION_ID = dataPrivacyTestGraph.organizationId;

function process(role: "api" | "worker", googleCredentials?: string) {
  return createApp({ role, secrets: dataPrivacyTestSecrets({ googleCredentials }) })
    .withModules([dataPrivacyProcessModule])
    .withStores(memoryStores())
    .withConfig({
      "data-privacy": {
        googleDlpDisabled: undefined,
        enforcement: undefined,
        nodeEnvironment: undefined,
        langevalsEndpoint: undefined,
      },
    })
    .provide({
      authz: createApiFixture<AuthzApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
    });
}

describe("data privacy app installation", () => {
  it("installs a working app in the api role, which refuses a project it has not folded", async () => {
    const runtime = await process("api").boot();

    try {
      const app = runtime.service(DataPrivacyApi);

      expect(runtime.module(dataPrivacyProcessModule).provided).toBe(app);
      await expect(app.getResolvedForProject({ projectId: PROJECT_ID })).rejects.toMatchObject({
        code: "project_not_found",
      });
      await expect(app.listOrganizationRules({ organizationId: ORGANIZATION_ID })).resolves.toEqual(
        [],
      );
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "Data privacy keeps no project peer" */
  it("names no project peer and, in the worker role, resolves a project from its own fold", async () => {
    const eventing = dataPrivacyTestEventing();
    const append = projectFactOwner(eventing);
    const runtime = await process("worker").withEventing(eventing).boot();
    await runtime.start();

    try {
      const app = runtime.service(DataPrivacyApi);
      expect(Object.keys(DataPrivacyModule.dependencies)).not.toContain("projects");

      await foldDataPrivacyTestProject({ append, app });

      await expect(app.getResolvedForProject({ projectId: PROJECT_ID })).resolves.toEqual(
        PLATFORM_DEFAULT_DATA_PRIVACY,
      );
      await expect(app.dropsAnyContent({ projectId: PROJECT_ID })).resolves.toBe(false);
    } finally {
      await runtime.stop();
      await eventing.close();
    }
  });

  /** @scenario "A peer borrows the Google credential without the value leaving data privacy" */
  it("lends the Google credential to a peer's closure, and undefined where none is set", async () => {
    const configured = await process("api", "service-account-json").boot();
    const unconfigured = await process("api").boot();

    try {
      const lend = (runtime: typeof configured) =>
        runtime.service(DataPrivacyApi).intoGoogleApplicationCredentials((credential) => ({
          credential,
        }));

      expect(lend(configured)).toEqual({ credential: "service-account-json" });
      expect(lend(unconfigured)).toEqual({ credential: undefined });
    } finally {
      await configured.stop();
      await unconfigured.stop();
    }
  });
});
