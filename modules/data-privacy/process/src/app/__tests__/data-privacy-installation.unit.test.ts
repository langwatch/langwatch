import { createApiFixture } from "@langwatch/api-fixture";
import { AuthzApi } from "@langwatch/authz-contract";
import { DataPrivacyApi, PLATFORM_DEFAULT_DATA_PRIVACY } from "@langwatch/data-privacy-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApp } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { dataPrivacyServer } from "../../data-privacy.server.ts";
import {
  createDataPrivacyTestProjects,
  installableDataPrivacy,
  dataPrivacyTestInfrastructure,
  dataPrivacyTestGraph,
} from "./data-privacy.fixture.ts";

const PROJECT_ID = dataPrivacyTestGraph.projectId;
const ORGANIZATION_ID = dataPrivacyTestGraph.organizationId;

function process(role: "api" | "worker", googleCredentials?: string) {
  return createApp({ role })
    .withModules([installableDataPrivacy(googleCredentials)])
    .withMember("dataPrivacy", dataPrivacyTestInfrastructure())
    .provide({
      project: createDataPrivacyTestProjects(),
      organization: createApiFixture<OrganizationApi>(),
      authz: createApiFixture<AuthzApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
    });
}

describe("data privacy app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(DataPrivacyApi);

      expect(runtime.module(dataPrivacyServer).provided).toBe(app);

      await expect(app.getResolvedForProject({ projectId: PROJECT_ID })).resolves.toEqual(
        PLATFORM_DEFAULT_DATA_PRIVACY,
      );
      await expect(app.dropsAnyContent({ projectId: PROJECT_ID })).resolves.toBe(false);
      await expect(app.listOrganizationRules({ organizationId: ORGANIZATION_ID })).resolves.toEqual(
        [],
      );
    } finally {
      await runtime.stop();
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
