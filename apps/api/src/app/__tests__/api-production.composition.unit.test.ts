import { AgentService } from "@langwatch/agent-contract";
import {
  ApiKeyService,
  type OrganizationApiKeyResolution,
  type ResolvedApiKeyToken,
} from "@langwatch/api-key-contract";
import { AuthService } from "@langwatch/auth-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { SecretService, type Secret } from "@langwatch/secret-contract";
import { OrganizationService } from "@langwatch/organization-contract";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

const processMocks = vi.hoisted(() => {
  const process = { start: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
  let rest: Hono | undefined;
  const create = vi.fn((options: { rest?: Hono }) => {
    rest = options.rest;
    return process;
  });
  return { create, process, rest: () => rest };
});

vi.mock("../../api.process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api.process")>();
  return { ...actual, ApiProcess: { create: processMocks.create } };
});

import { ApiProcessGraphPort } from "../../api.process";
import {
  ApiAuthSessionCompositionPort,
  ApiBrowserSessionTransportPort,
} from "../api-auth.composition";
import { ApiProductionComposition } from "../api-production.composition";
import { ApiAuditPort } from "../../api-request.policy";
import { resolveApiConfig } from "../../platform/config/api.config";

const resolvedKey: ResolvedApiKeyToken = {
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
    teamId: "team-1",
    organizationId: "org-1",
    isPersonal: false,
    ownerUserId: null,
  },
};

const secret: Secret = {
  id: "secret-1",
  projectId: "project-1",
  name: "OPENAI_API_KEY",
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  updatedAt: new Date("2026-08-28T00:00:00.000Z"),
  createdBy: { name: "Alex" },
  updatedBy: { name: "Alex" },
};

describe("ApiProductionComposition", () => {
  it("constructs one API-key REST adapter in process composition and propagates its actor and ceiling", async () => {
    const apiKeys = apiKeyService(resolvedKey);
    const authz = authzService(true);
    const secrets = secretService();
    const audit = new TestAudit();
    const composition = ApiProductionComposition.create({
      agents: new Proxy(AgentService.prototype, {}),
      secrets: secrets.service,
      apiKeys: apiKeys.service,
      authz: authz.service,
      organizations: organizationService(),
      auth: new TestAuthComposition(),
      audit,
    });

    await composition.compose({
      config: resolveApiConfig({ NODE_ENV: "test", API_PORT: "5560" }),
      graph: new TestGraph(),
      observability: { serviceName: "langwatch-api-test" },
      resources: new ResourceScope(),
    });

    const rest = processMocks.rest();
    if (!rest) {
      throw new Error("API production composition did not install REST routes.");
    }
    const response = await rest.request("/api/secret", {
      method: "POST",
      headers: {
        authorization: "Bearer current-token",
        "X-Project-Id": "project-1",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: "project-1",
        name: "OPENAI_API_KEY",
        value: "secret-value",
      }),
    });

    expect(response.status).toBe(201);
    expect(apiKeys.tryResolveToken).toHaveBeenCalledWith({
      token: "current-token",
      projectId: "project-1",
    });
    expect(authz.hasApiKeyPermission).toHaveBeenCalledWith({
      apiKeyId: "key-1",
      userId: "user-1",
      organizationId: "org-1",
      scope: { type: "project", id: "project-1", teamId: "team-1" },
      permission: "secrets:manage",
    });
    expect(secrets.create).toHaveBeenCalledWith({
      projectId: "project-1",
      name: "OPENAI_API_KEY",
      value: "secret-value",
      actorId: "user-1",
    });
    expect(apiKeys.markUsed).toHaveBeenCalledWith({ id: "key-1" });
    expect(audit.record).toHaveBeenCalledWith({
      actorId: "user-1",
      path: "/api/secret",
      input: { method: "POST", projectId: "project-1", status: 201 },
      error: null,
    });
  });

  it("installs organization API-key management with canonical org resolution and permission checks", async () => {
    const apiKeys = apiKeyService(resolvedKey);
    const authz = authzService(true);
    const audit = new TestAudit();
    const composition = ApiProductionComposition.create({
      agents: new Proxy(AgentService.prototype, {}),
      secrets: secretService().service,
      apiKeys: apiKeys.service,
      authz: authz.service,
      organizations: organizationService(),
      auth: new TestAuthComposition(),
      audit,
    });

    await composition.compose({
      config: resolveApiConfig({ NODE_ENV: "test", API_PORT: "5560" }),
      graph: new TestGraph(),
      observability: { serviceName: "langwatch-api-test" },
      resources: new ResourceScope(),
    });

    const rest = processMocks.rest();
    if (!rest) {
      throw new Error("API production composition did not install REST routes.");
    }
    const response = await rest.request("/api/api-keys", {
      headers: { authorization: "Bearer pat-lw-current" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          id: "key-1",
          name: "Current key",
          description: null,
          createdAt: "2026-08-28T00:00:00.000Z",
          expiresAt: null,
          lastUsedAt: null,
          revokedAt: null,
          roleBindings: [],
        },
      ],
    });
    expect(apiKeys.resolveOrganizationToken).toHaveBeenCalledWith({ token: "pat-lw-current" });
    expect(authz.hasApiKeyPermission).toHaveBeenCalledWith({
      apiKeyId: "key-1",
      userId: "user-1",
      organizationId: "org-1",
      scope: { type: "org", id: "org-1" },
      permission: "organization:view",
    });
    expect(apiKeys.markUsed).toHaveBeenCalledWith({ id: "key-1" });

    const detail = await rest.request("/api/api-keys/key-1", {
      headers: { authorization: "Bearer pat-lw-current" },
    });
    expect(detail.status).toBe(200);
    await vi.waitFor(() => {
      expect(audit.record).toHaveBeenCalledWith({
        actorId: "user-1",
        path: "/api/api-keys/key-1",
        input: {
          organizationId: "org-1",
          action: "management.apiKey.read",
          args: { apiKeyId: "key-1" },
        },
        error: null,
      });
    });
  });
});

class TestGraph extends ApiProcessGraphPort {
  async close(): Promise<void> {}
}

class TestAuthComposition extends ApiAuthSessionCompositionPort {
  compose() {
    return { auth: new TestAuthService(), sessions: new TestSessionTransport() };
  }
}

class TestAuthService extends AuthService {
  async tryResolveBrowserSession() {
    return null;
  }

  async revokeAllBrowserSessions(): Promise<void> {}
  async revokeBrowserSession(): Promise<void> {}
  async revokeOtherBrowserSessions(): Promise<void> {}
}

class TestSessionTransport extends ApiBrowserSessionTransportPort {
  async tryResolveVerifiedSession() {
    return null;
  }
}

class TestAudit extends ApiAuditPort {
  readonly record = vi.fn(async () => undefined);
}

function apiKeyService(resolved: ResolvedApiKeyToken) {
  const tryResolveToken = vi.fn<ApiKeyService["tryResolveToken"]>().mockResolvedValue(resolved);
  const markUsed = vi.fn();
  const resolveOrganizationToken = vi
    .fn<ApiKeyService["resolveOrganizationToken"]>()
    .mockResolvedValue({
      ok: true,
      resolved: {
        type: "apiKey-org",
        apiKeyId: "key-1",
        userId: "user-1",
        organizationId: "org-1",
      },
    } satisfies OrganizationApiKeyResolution);
  const isOrgAdmin = vi.fn<ApiKeyService["isOrgAdmin"]>().mockResolvedValue(true);
  const list = vi.fn<ApiKeyService["list"]>().mockResolvedValue([
    {
      id: "key-1",
      name: "Current key",
      description: null,
      organizationId: "org-1",
      userId: "user-1",
      createdByUserId: "user-1",
      createdByDeviceLabel: null,
      lookupId: "lookup-1",
      permissionMode: "all",
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      ingestSourceType: null,
      ingestionTemplateId: null,
      createdAt: new Date("2026-08-28T00:00:00.000Z"),
      updatedAt: new Date("2026-08-28T00:00:00.000Z"),
      roleBindings: [],
    },
  ]);
  const getByIdForCaller = vi.fn<ApiKeyService["getByIdForCaller"]>().mockResolvedValue({
    id: "key-1",
    name: "Current key",
    description: null,
    organizationId: "org-1",
    userId: "user-1",
    createdByUserId: "user-1",
    createdByDeviceLabel: null,
    lookupId: "lookup-1",
    permissionMode: "all",
    permissions: [],
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    updatedAt: new Date("2026-08-28T00:00:00.000Z"),
    roleBindings: [],
  });
  const service = new Proxy(ApiKeyService.prototype, {
    get(target, property, receiver) {
      if (property === "tryResolveToken") return tryResolveToken;
      if (property === "markUsed") return markUsed;
      if (property === "resolveOrganizationToken") return resolveOrganizationToken;
      if (property === "isOrgAdmin") return isOrgAdmin;
      if (property === "list") return list;
      if (property === "getByIdForCaller") return getByIdForCaller;
      return Reflect.get(target, property, receiver);
    },
  });
  return {
    service,
    tryResolveToken,
    resolveOrganizationToken,
    isOrgAdmin,
    list,
    getByIdForCaller,
    markUsed,
  };
}

function authzService(allowed: boolean) {
  const hasApiKeyPermission = vi
    .fn<AuthzService["hasApiKeyPermission"]>()
    .mockResolvedValue(allowed);
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
  return new Proxy(OrganizationService.prototype, {
    get(target, property, receiver) {
      return property === "getSettings"
        ? async () => ({ id: "org-1" })
        : Reflect.get(target, property, receiver);
    },
  });
}

function secretService() {
  const create = vi.fn<SecretService["create"]>().mockResolvedValue(secret);
  const service = new Proxy(SecretService.prototype, {
    get(target, property, receiver) {
      return property === "create" ? create : Reflect.get(target, property, receiver);
    },
  });
  return { service, create };
}
