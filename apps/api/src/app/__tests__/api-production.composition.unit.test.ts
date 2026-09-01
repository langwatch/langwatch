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

// The queue infrastructure owns the process's Redis client, and composing a
// real one opens a socket. Only its composition decision is mocked: absent by
// default, which is the deployment shape every other test here describes.
const queueMocks = vi.hoisted(() => {
  const redis = {
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    ttl: vi.fn(async () => 30),
  };
  const composed: { value: { redis: typeof redis } | undefined } = { value: undefined };
  return { redis, composed, tryCreate: vi.fn(() => composed.value) };
});

vi.mock("../../platform/infrastructure/api-queue.infrastructure", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../platform/infrastructure/api-queue.infrastructure")>();
  return { ...actual, ApiQueueInfrastructure: { tryCreate: queueMocks.tryCreate } };
});

import { ApiProcessGraphPort } from "../../api.process";
import {
  ApiAuthSessionCompositionPort,
  ApiBrowserSessionTransportPort,
} from "../api-auth.composition";
import {
  ApiProductionComposition,
  type ApiOwnedRestFeaturePorts,
} from "../api-production.composition";
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
        path: "management.apiKey.read",
        input: {
          organizationId: "org-1",
          action: "management.apiKey.read",
          args: { apiKeyId: "key-1" },
        },
        error: null,
      });
    });
  });

  describe("given the REST feature ports the API process now owns itself", () => {
    describe("when the process has not been composed", () => {
      it("offers no ports, because the limiter's Redis does not exist yet", () => {
        expect(productionComposition().restFeaturePorts()).toBeUndefined();
      });
    });

    describe("when the deployment configured an instance administrator credential", () => {
      it("answers with it, without any host supplying a PAT adapter", async () => {
        const ports = await composedFeaturePorts({
          LANGWATCH_INSTANCE_ADMIN_API_KEY: " instance-admin-secret ",
        });

        expect(ports.instanceAdminKey()).toBe("instance-admin-secret");
      });
    });

    describe("when the deployment configured no instance administrator credential", () => {
      it("answers with nothing, which is what makes the family answer 404", async () => {
        const unset = await composedFeaturePorts({});
        const blank = await composedFeaturePorts({ LANGWATCH_INSTANCE_ADMIN_API_KEY: "" });

        expect([unset.instanceAdminKey(), blank.instanceAdminKey()]).toEqual([
          undefined,
          undefined,
        ]);
      });
    });

    describe("when the process composed a Redis connection", () => {
      it("counts in the same Redis the queue infrastructure composed", async () => {
        queueMocks.composed.value = { redis: queueMocks.redis };
        try {
          const ports = await composedFeaturePorts({});

          expect(
            await ports.rateLimit({ key: "project-1", windowSeconds: 60, max: 5 }),
          ).toHaveProperty("allowed", true);
          expect(queueMocks.redis.incr).toHaveBeenCalledWith("langwatch:ratelimit:project-1");
        } finally {
          queueMocks.composed.value = undefined;
        }
      });
    });

    describe("when the process composed no Redis", () => {
      it("still counts a caller's window, and refuses the hit past the maximum", async () => {
        const ports = await composedFeaturePorts({});
        const request = { key: "project-1", windowSeconds: 60, max: 1 };

        expect(await ports.rateLimit(request)).toHaveProperty("allowed", true);
        expect(await ports.rateLimit(request)).toHaveProperty("allowed", false);
      });

      it("counts each caller against its own window", async () => {
        const ports = await composedFeaturePorts({});

        await ports.rateLimit({ key: "project-1", windowSeconds: 60, max: 1 });

        expect(
          await ports.rateLimit({ key: "project-2", windowSeconds: 60, max: 1 }),
        ).toHaveProperty("allowed", true);
      });
    });
  });
});

function productionComposition(): ApiProductionComposition {
  return ApiProductionComposition.create({
    agents: new Proxy(AgentService.prototype, {}),
    secrets: secretService().service,
    apiKeys: apiKeyService(resolvedKey).service,
    authz: authzService(true).service,
    organizations: organizationService(),
    auth: new TestAuthComposition(),
  });
}

async function composedFeaturePorts(
  source: Readonly<Record<string, unknown>>,
): Promise<ApiOwnedRestFeaturePorts> {
  const composition = productionComposition();
  await composition.compose({
    config: resolveApiConfig({ NODE_ENV: "test", API_PORT: "5560", ...source }),
    graph: new TestGraph(),
    observability: { serviceName: "langwatch-api-test" },
    resources: new ResourceScope(),
  });

  const ports = composition.restFeaturePorts();
  if (!ports) {
    throw new Error("API production composition did not compose its own REST feature ports.");
  }
  return ports;
}

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
