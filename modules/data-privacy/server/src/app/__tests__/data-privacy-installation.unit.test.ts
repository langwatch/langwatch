import { AuthzApi } from "@langwatch/authz-contract";
import { DataPrivacyApi, PLATFORM_DEFAULT_DATA_PRIVACY } from "@langwatch/data-privacy-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";
import { dataPrivacyServer } from "../../data-privacy.server.ts";
import {
  createDataPrivacyTestProjects,
  dataPrivacyTestGraph,
  dataPrivacyTestInfrastructure,
} from "./data-privacy.fixture.ts";

const PROJECT_ID = dataPrivacyTestGraph.projectId;
const ORGANIZATION_ID = dataPrivacyTestGraph.organizationId;

function process() {
  return createApp({ name: "data-privacy-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withProvided(ProjectApi, createDataPrivacyTestProjects())
    .withProvided(OrganizationApi, createApiFixture<OrganizationApi>())
    .withProvided(AuthzApi, createApiFixture<AuthzApi>())
    .withProvided(FeatureFlagApi, createApiFixture<FeatureFlagApi>())
    .withModule(dataPrivacyServer, { infrastructure: dataPrivacyTestInfrastructure() });
}

describe("data privacy app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process().boot({ role });

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
});
