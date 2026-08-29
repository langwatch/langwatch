import { ApiKeyService, type OrganizationApiKeyResolution } from "@langwatch/api-key-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { OrganizationNotFoundError, OrganizationService } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";
import {
  ApiKeyOrganizationRestSecurityAdapter,
  ApiOrganizationAuthenticationError,
} from "../api-key-organization-rest-security.adapter";

describe("ApiKeyOrganizationRestSecurityAdapter", () => {
  it("uses the established header precedence while resolving an organization token", async () => {
    const apiKeys = apiKeyService(resolvedOrganizationKey());
    const security = ApiKeyOrganizationRestSecurityAdapter.create({
      apiKeys: apiKeys.service,
      authz: authzService().service,
      organizations: organizationService().service,
    });
    const basic = Buffer.from("project-ignored:pat-lw-basic").toString("base64");

    await expect(
      security.authenticate(
        new Request("http://api.test/api/api-keys", {
          headers: {
            authorization: `Basic ${basic}`,
            "x-auth-token": "fallback-token",
            "x-project-id": "also-ignored",
          },
        }),
      ),
    ).resolves.toEqual({
      organizationId: "org-1",
      apiKeyId: "key-1",
      actor: { id: "user-1" },
    });
    expect(apiKeys.resolveOrganizationToken).toHaveBeenCalledWith({ token: "pat-lw-basic" });
  });

  it("keeps wrong credential class actionable and unusable credentials opaque", async () => {
    const apiKeys = apiKeyService({ ok: false, reason: "wrong_credential_class" });
    const security = ApiKeyOrganizationRestSecurityAdapter.create({
      apiKeys: apiKeys.service,
      authz: authzService().service,
      organizations: organizationService().service,
    });

    await expect(
      security.authenticate(
        new Request("http://api.test/api/api-keys", {
          headers: { authorization: "Bearer sk-lw-project" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "credential_class_mismatch",
      httpStatus: 401,
      meta: { required: "organization_api_key", presented: "project_api_key" },
    });

    apiKeys.resolveOrganizationToken.mockResolvedValue({
      ok: false,
      reason: "unusable_credential",
    });
    await expect(
      security.authenticate(
        new Request("http://api.test/api/api-keys", {
          headers: { authorization: "Bearer pat-lw-revoked" },
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_credentials", httpStatus: 401 });
  });

  it("preserves an orphaned organization's 401 and selects admin checks by actor kind", async () => {
    const apiKeys = apiKeyService(resolvedOrganizationKey());
    const organizations = organizationService();
    organizations.getSettings.mockRejectedValue(new OrganizationNotFoundError());
    const security = ApiKeyOrganizationRestSecurityAdapter.create({
      apiKeys: apiKeys.service,
      authz: authzService().service,
      organizations: organizations.service,
    });

    await expect(
      security.authenticate(
        new Request("http://api.test/api/api-keys", {
          headers: { authorization: "Bearer pat-lw-orphaned" },
        }),
      ),
    ).rejects.toBeInstanceOf(ApiOrganizationAuthenticationError);
    await expect(
      security.authenticate(
        new Request("http://api.test/api/api-keys", {
          headers: { authorization: "Bearer pat-lw-orphaned" },
        }),
      ),
    ).rejects.toMatchObject({ code: "organization_not_found", httpStatus: 401 });

    organizations.getSettings.mockResolvedValue(organizationSettings());
    const userRequest = await security.authenticate(
      new Request("http://api.test/api/api-keys", {
        headers: { authorization: "Bearer pat-lw-user" },
      }),
    );
    await security.isAdmin({ request: userRequest });
    expect(apiKeys.isOrgAdmin).toHaveBeenCalledWith({ userId: "user-1", organizationId: "org-1" });

    apiKeys.resolveOrganizationToken.mockResolvedValue({
      ok: true,
      resolved: {
        type: "apiKey-org",
        apiKeyId: "service-key-1",
        userId: null,
        organizationId: "org-1",
      },
    });
    const serviceRequest = await security.authenticate(
      new Request("http://api.test/api/api-keys", {
        headers: { authorization: "Bearer sk-lw-service" },
      }),
    );
    await security.isAdmin({ request: serviceRequest });
    expect(apiKeys.isOrgAdminApiKey).toHaveBeenCalledWith({
      apiKeyId: "service-key-1",
      organizationId: "org-1",
    });
  });
});

function resolvedOrganizationKey(): OrganizationApiKeyResolution {
  return {
    ok: true,
    resolved: {
      type: "apiKey-org",
      apiKeyId: "key-1",
      userId: "user-1",
      organizationId: "org-1",
    },
  };
}

function apiKeyService(resolution: OrganizationApiKeyResolution) {
  const resolveOrganizationToken = vi
    .fn<ApiKeyService["resolveOrganizationToken"]>()
    .mockResolvedValue(resolution);
  const isOrgAdmin = vi.fn<ApiKeyService["isOrgAdmin"]>().mockResolvedValue(true);
  const isOrgAdminApiKey = vi.fn<ApiKeyService["isOrgAdminApiKey"]>().mockResolvedValue(true);
  const markUsed = vi.fn();
  const service = new Proxy(ApiKeyService.prototype, {
    get(target, property, receiver) {
      if (property === "resolveOrganizationToken") return resolveOrganizationToken;
      if (property === "isOrgAdmin") return isOrgAdmin;
      if (property === "isOrgAdminApiKey") return isOrgAdminApiKey;
      if (property === "markUsed") return markUsed;
      return Reflect.get(target, property, receiver);
    },
  });
  return { service, resolveOrganizationToken, isOrgAdmin, isOrgAdminApiKey, markUsed };
}

function authzService() {
  const hasApiKeyPermission = vi.fn<AuthzService["hasApiKeyPermission"]>().mockResolvedValue(true);
  const service = new Proxy(AuthzService.prototype, {
    get(target, property, receiver) {
      return property === "hasApiKeyPermission"
        ? hasApiKeyPermission
        : Reflect.get(target, property, receiver);
    },
  });
  return { service, hasApiKeyPermission };
}

function organizationService() {
  const getSettings = vi
    .fn<OrganizationService["getSettings"]>()
    .mockResolvedValue(organizationSettings());
  const service = new Proxy(OrganizationService.prototype, {
    get(target, property, receiver) {
      return property === "getSettings" ? getSettings : Reflect.get(target, property, receiver);
    },
  });
  return { service, getSettings };
}

function organizationSettings() {
  return {
    id: "org-1",
    name: "Organization one",
    slug: "organization-one",
    supportContact: null,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3Bucket: null,
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    updatedAt: new Date("2026-08-28T00:00:00.000Z"),
  };
}
