import { ApiKeyService, type ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import {
  ApiKeyRestSecurityAdapter,
  ApiRestAuthenticationError,
} from "../src/app/api-key-rest-security.adapter";

const currentKey: ResolvedApiKeyToken = {
  type: "apiKey",
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: "org-1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  project: {
    id: "project-1",
    name: "Project one",
    slug: "project-one",
    apiKey: "legacy-project-key",
    lwqlKey: "lwql-key",
    teamId: "team-1",
    language: "typescript",
    framework: "nextjs",
    kind: "APPLICATION",
    firstMessage: false,
    integrated: false,
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    updatedAt: new Date("2026-08-28T00:00:00.000Z"),
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: null,
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    team: {
      id: "team-1",
      name: "Team one",
      slug: "team-one",
      organizationId: "org-1",
      createdAt: new Date("2026-08-28T00:00:00.000Z"),
      updatedAt: new Date("2026-08-28T00:00:00.000Z"),
      archivedAt: null,
      isPersonal: false,
      ownerUserId: null,
      departmentId: null,
    },
  },
};

describe("ApiKeyRestSecurityAdapter", () => {
  it("passes the exact X-Project-Id target to canonical current-key resolution", async () => {
    const apiKeys = new TestApiKeys();
    apiKeys.tryResolveToken.mockResolvedValue(currentKey);
    const security = ApiKeyRestSecurityAdapter.create({ apiKeys, authz: new TestAuthz() });

    await expect(
      security.authenticate(
        new Request("http://api.test/api/secret", {
          headers: {
            authorization: "Bearer sk-lw-token",
            "X-Project-Id": "project-1",
          },
        }),
      ),
    ).resolves.toEqual({
      projectId: "project-1",
      actor: { id: "user-1" },
      apiKeyId: "key-1",
      organizationId: "org-1",
      teamId: "team-1",
      isLangySessionKey: false,
    });
    expect(apiKeys.tryResolveToken).toHaveBeenCalledWith({
      token: "sk-lw-token",
      projectId: "project-1",
    });
  });

  it("keeps Basic's encoded project target and falls back to X-Auth-Token for malformed Basic", async () => {
    const apiKeys = new TestApiKeys();
    apiKeys.tryResolveToken.mockResolvedValue(currentKey);
    const security = ApiKeyRestSecurityAdapter.create({ apiKeys, authz: new TestAuthz() });

    await security.authenticate(
      new Request("http://api.test/api/secret", {
        headers: {
          authorization: `Basic ${Buffer.from("project-1:basic-token").toString("base64")}`,
        },
      }),
    );
    await security.authenticate(
      new Request("http://api.test/api/secret", {
        headers: { authorization: "Basic malformed", "X-Auth-Token": "fallback-token" },
      }),
    );

    expect(apiKeys.tryResolveToken).toHaveBeenNthCalledWith(1, {
      token: "basic-token",
      projectId: "project-1",
    });
    expect(apiKeys.tryResolveToken).toHaveBeenNthCalledWith(2, {
      token: "fallback-token",
      projectId: null,
    });
  });

  it("keeps legacy project keys actorless and outside the permission ceiling", async () => {
    const apiKeys = new TestApiKeys();
    apiKeys.tryResolveToken.mockResolvedValue({
      type: "legacyProjectKey",
      project: currentKey.project,
    });
    const authz = new TestAuthz();
    const security = ApiKeyRestSecurityAdapter.create({ apiKeys, authz });

    const request = await security.authenticate(
      new Request("http://api.test/api/secret", {
        headers: { "X-Auth-Token": "legacy-token", "X-Project-Id": "other-project" },
      }),
    );
    await security.authorize({ request, permission: "secrets:manage" });

    expect(request).toEqual({ projectId: "project-1", actor: null });
    expect(authz.hasApiKeyPermission).not.toHaveBeenCalled();
  });

  it("delegates current key ceilings to canonical AuthZ with resolved project lineage", async () => {
    const apiKeys = new TestApiKeys();
    apiKeys.tryResolveToken.mockResolvedValue(currentKey);
    const authz = new TestAuthz();
    authz.hasApiKeyPermission.mockResolvedValue(false);
    const security = ApiKeyRestSecurityAdapter.create({ apiKeys, authz });
    const request = await security.authenticate(
      new Request("http://api.test/api/secret", {
        headers: { authorization: "Bearer current-token", "X-Project-Id": "project-1" },
      }),
    );

    await expect(
      security.authorize({ request, permission: "secrets:manage" }),
    ).rejects.toMatchObject({
      code: "api_key_permission_denied",
      httpStatus: 403,
    });
    expect(authz.hasApiKeyPermission).toHaveBeenCalledWith({
      apiKeyId: "key-1",
      userId: "user-1",
      organizationId: "org-1",
      scope: { type: "project", id: "project-1", teamId: "team-1" },
      permission: "secrets:manage",
    });
  });

  it("keeps Langy's never-delegable ceiling refusal distinct", async () => {
    const apiKeys = new TestApiKeys();
    apiKeys.tryResolveToken.mockResolvedValue({ ...currentKey, isLangySessionKey: true });
    const authz = new TestAuthz();
    authz.hasApiKeyPermission.mockResolvedValue(false);
    const security = ApiKeyRestSecurityAdapter.create({ apiKeys, authz });
    const request = await security.authenticate(
      new Request("http://api.test/api/secret", {
        headers: { authorization: "Bearer current-token", "X-Project-Id": "project-1" },
      }),
    );

    await expect(
      security.authorize({ request, permission: "triggers:create" }),
    ).rejects.toMatchObject({
      code: "api_key_permission_not_delegable",
      httpStatus: 403,
    });
  });

  it("distinguishes missing from invalid credentials", async () => {
    const apiKeys = new TestApiKeys();
    const security = ApiKeyRestSecurityAdapter.create({ apiKeys, authz: new TestAuthz() });

    await expect(
      security.authenticate(new Request("http://api.test/api/secret")),
    ).rejects.toBeInstanceOf(ApiRestAuthenticationError);
    apiKeys.tryResolveToken.mockResolvedValue(null);
    await expect(
      security.authenticate(
        new Request("http://api.test/api/secret", { headers: { "X-Auth-Token": "bad-token" } }),
      ),
    ).rejects.toMatchObject({ code: "invalid_credentials", httpStatus: 401 });
  });
});

class TestApiKeys extends ApiKeyService {
  readonly tryResolveToken = vi.fn<ApiKeyService["tryResolveToken"]>();

  private unavailable(): never {
    throw new Error("Unexpected API-key service call");
  }

  create() {
    return this.unavailable();
  }
  update() {
    return this.unavailable();
  }
  tryVerify() {
    return this.unavailable();
  }
  regenerateLegacyProjectKey() {
    return this.unavailable();
  }
  resolveOrganizationToken() {
    return this.unavailable();
  }
  resolveVisibleProjects() {
    return this.unavailable();
  }
  markUsed() {
    return this.unavailable();
  }
  list() {
    return this.unavailable();
  }
  listAll() {
    return this.unavailable();
  }
  revoke() {
    return this.unavailable();
  }
  ensureCallerIsOrgMember() {
    return this.unavailable();
  }
  assertSelectionWithinCeiling() {
    return this.unavailable();
  }
  isOrgAdmin() {
    return this.unavailable();
  }
  isOrgAdminApiKey() {
    return this.unavailable();
  }
  tryGetById() {
    return this.unavailable();
  }
  getByIdForCaller() {
    return this.unavailable();
  }
  tryGetNameByIdInOrg() {
    return this.unavailable();
  }
  getUserBindings() {
    return this.unavailable();
  }
  getOrgProjects() {
    return this.unavailable();
  }
  getOrgTeams() {
    return this.unavailable();
  }
  getOrgMembers() {
    return this.unavailable();
  }
  tryGetIngestionKey() {
    return this.unavailable();
  }
  listIngestionKeysForProject() {
    return this.unavailable();
  }
  validateCliSelection() {
    return this.unavailable();
  }
  tryResolveDefaultCliSelection() {
    return this.unavailable();
  }
  mintCliLoginKey() {
    return this.unavailable();
  }
  revokeCliLoginKeysForDevice() {
    return this.unavailable();
  }
  revokeCliLoginKeyForLogout() {
    return this.unavailable();
  }
  enrichBindingsWithNames() {
    return this.unavailable();
  }
  enrichApiKeyList() {
    return this.unavailable();
  }
}

class TestAuthz extends AuthzService {
  readonly hasApiKeyPermission = vi.fn<AuthzService["hasApiKeyPermission"]>();

  private unavailable(): never {
    throw new Error("Unexpected AuthZ service call");
  }

  check() {
    return this.unavailable();
  }
  checkDetailed() {
    return this.unavailable();
  }
  can() {
    return this.unavailable();
  }
  authorize() {
    return this.unavailable();
  }
  effectivePermissions() {
    return this.unavailable();
  }
  checkByIds() {
    return this.unavailable();
  }
  canAnyByIds() {
    return this.unavailable();
  }
  canBatchByIds() {
    return this.unavailable();
  }
  tryResolveScope() {
    return this.unavailable();
  }
  checkScopeLineage() {
    return this.unavailable();
  }
  explainDecision() {
    return this.unavailable();
  }
  getDecision() {
    return this.unavailable();
  }
  getProjectAnyDecision() {
    return this.unavailable();
  }
  hasPermission() {
    return this.unavailable();
  }
  authorizePermission() {
    return this.unavailable();
  }
  authorizeProjectPermission() {
    return this.unavailable();
  }
  getApiKeyProjectDecision() {
    return this.unavailable();
  }
  listUserBindings() {
    return this.unavailable();
  }
  listOrganizationBindings() {
    return this.unavailable();
  }
  listUserAndGroupBindings() {
    return this.unavailable();
  }
  listScopeBindings() {
    return this.unavailable();
  }
  listGroupBindings() {
    return this.unavailable();
  }
  listTeamMemberBindings() {
    return this.unavailable();
  }
  listBindingsForSynthesis() {
    return this.unavailable();
  }
  listUserCreatedRoles() {
    return this.unavailable();
  }
  wouldFirstBindingDisableLegacyAccess() {
    return this.unavailable();
  }
  listManagedBindingsForUser() {
    return this.unavailable();
  }
  listManagedBindingsForOrganization() {
    return this.unavailable();
  }
  getAccessBreakdown() {
    return this.unavailable();
  }
  isOnEngine() {
    return this.unavailable();
  }
  tryGetEngineCutoverAt() {
    return this.unavailable();
  }
}
