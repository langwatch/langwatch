/**
 * ADR-208 through the app: who may add an API key to a rule is read from the caller's own
 * `organization:manage`, not handed in, so a project admin keeps the rule's keys but adds none.
 */
import type { ApiKey } from "@langwatch/api-key-contract";
import type { AuthzApi, AuthzCanBatchByIdsInput } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryDataPrivacyDirectoryRepository } from "../../repositories/memory/memory.data-privacy-directory.repository.ts";
import { createDataPrivacyTestApp, dataPrivacyTestGraph } from "./data-privacy.fixture.ts";

const { projectId, teamId, organizationId } = dataPrivacyTestGraph;
const USER_ID = "user-1";
const AT = new Date(0);

const AGENT_KEY: ApiKey = {
  id: "key-agent",
  name: "Trace analysis agent",
  description: null,
  organizationId,
  userId: null,
  createdByUserId: null,
  createdByDeviceLabel: null,
  lookupId: "lookup-key-agent",
  permissionMode: "all",
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
  ingestSourceType: null,
  ingestionTemplateId: null,
  createdAt: AT,
  updatedAt: AT,
  grants: [],
};

/** A caller who may write the project's rule, and manages the organization or not. */
async function appFor({
  managesOrganization,
}: {
  managesOrganization: boolean;
}): Promise<DataPrivacyApi> {
  const authz = createApiFixture<AuthzApi>({
    hasPermission: async ({ permission }) =>
      permission !== "organization:manage" || managesOrganization,
    checkScopeLineage: async () => ({ kind: "consistent" }),
    canBatchByIds: async (input: AuthzCanBatchByIdsInput) => ({
      teams: new Map(input.teams.map((team) => [team.teamId, true])),
      projects: new Map(input.projects.map((project) => [project.projectId, true])),
      organizationRole: null,
    }),
  });
  return createDataPrivacyTestApp({
    directory: MemoryDataPrivacyDirectoryRepository.create({
      lineage: { projectId, name: "web-app", teamId, organizationId, organizationName: "Acme" },
      scopeOrganizationId: organizationId,
    }),
    dependencies: {
      permissions: authz,
      featureFlags: createApiFixture<FeatureFlagApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
    },
    organizationKeys: [AGENT_KEY],
  });
}

function saveNamingTheKey(app: DataPrivacyApi) {
  return app.setScopeRule({
    projectId,
    scope: { scopeType: "PROJECT", scopeId: projectId },
    personalOnly: false,
    config: {
      categories: {
        input: { disposition: "restrict", audience: { admins: true, apiKeyIds: ["key-agent"] } },
      },
    },
    userId: USER_ID,
  });
}

describe("given a rule save that adds an API key", () => {
  /** @scenario Only an organization admin adds a key to a rule */
  it("saves it for someone who manages the organization", async () => {
    const app = await appFor({ managesOrganization: true });
    await expect(saveNamingTheKey(app)).resolves.toMatchObject({ scopeId: projectId });
  });

  /** @scenario Only an organization admin adds a key to a rule */
  it("refuses it, as forbidden, for someone who only edits the project", async () => {
    const app = await appFor({ managesOrganization: false });
    await expect(saveNamingTheKey(app)).rejects.toMatchObject({
      code: "data_privacy_api_key_add_forbidden",
      httpStatus: 403,
      meta: { requiredPermission: "organization:manage" },
    });
  });
});
