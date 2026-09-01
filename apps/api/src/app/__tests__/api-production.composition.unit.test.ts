import { AgentService } from "@langwatch/agent-contract";
import {
  ApiKeyService,
  type OrganizationApiKeyResolution,
  type ResolvedApiKeyToken,
} from "@langwatch/api-key-contract";
import { AuthService } from "@langwatch/auth-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { LANGY_VK_SECRET_NAME, SecretService, type Secret } from "@langwatch/secret-contract";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import { OrganizationService } from "@langwatch/organization-contract";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const processMocks = vi.hoisted(() => {
  const process = { start: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
  let rest: Hono | undefined;
  let secrets: unknown;
  let metrics: unknown;
  const create = vi.fn((options: { rest?: Hono; secrets?: unknown; metrics?: unknown }) => {
    rest = options.rest;
    secrets = options.secrets;
    metrics = options.metrics;
    return process;
  });
  return {
    create,
    process,
    rest: () => rest,
    secrets: () => secrets,
    metrics: () => metrics,
  };
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

// Composing a real database infrastructure opens a pg pool. Only the
// construction decision is intercepted: what it hands back is the fake client
// below, so the packaged secret adapter, its repository and the cipher all
// stay real — they are what these scenarios are about.
const databaseMocks = vi.hoisted(() => {
  const rows: Array<{ name: string; encryptedValue: string }> = [];
  const findMany = vi.fn(async (query: { select?: Record<string, unknown> }) =>
    query.select && "encryptedValue" in query.select
      ? rows
      : rows.map((row) => ({
          id: `secret-${row.name}`,
          projectId: "project-1",
          name: row.name,
          createdAt: new Date("2026-08-28T00:00:00.000Z"),
          updatedAt: new Date("2026-08-28T00:00:00.000Z"),
          createdBy: { name: "Alex" },
          updatedBy: { name: "Alex" },
        })),
  );
  const client = { projectSecret: { findMany } };
  const configured: { value: boolean } = { value: false };
  return {
    rows,
    findMany,
    client,
    configured,
    tryCreate: vi.fn(() => (configured.value ? { connection: { client } } : undefined)),
  };
});

vi.mock("../../platform/infrastructure/api-database.infrastructure", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../platform/infrastructure/api-database.infrastructure")
    >();
  return { ...actual, ApiDatabaseInfrastructure: { tryCreate: databaseMocks.tryCreate } };
});

import { ApiMetricsPort } from "../../api-process.lifecycle";
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

const ENCRYPTION_KEY = "0f".repeat(32);

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

  describe("given the secret service this process can now compose itself", () => {
    beforeEach(() => {
      databaseMocks.rows.length = 0;
      databaseMocks.configured.value = false;
      databaseMocks.findMany.mockClear();
    });

    describe("when a host supplied one", () => {
      /** @scenario "A process with no key composes no secret service" */
      it("serves the host's service, whatever this deployment was configured with", async () => {
        databaseMocks.configured.value = true;
        const injected = secretService().service;
        const composition = productionComposition({ secrets: injected });

        await composition.compose({
          config: resolveApiConfig({
            NODE_ENV: "test",
            API_PORT: "5560",
            DATABASE_URL: "postgresql://localhost/langwatch",
            CREDENTIALS_SECRET: ENCRYPTION_KEY,
          }),
          graph: new TestGraph(),
          observability: { serviceName: "langwatch-api-test" },
          resources: new ResourceScope(),
        });

        expect(processMocks.secrets()).toBe(injected);
        expect(databaseMocks.findMany).not.toHaveBeenCalled();
      });
    });

    describe("when the deployment configured a database and a key", () => {
      it("composes its own service over the guarded client, with no host supplying one", async () => {
        databaseMocks.configured.value = true;

        await composeWithout({
          DATABASE_URL: "postgresql://localhost/langwatch",
          CREDENTIALS_SECRET: ENCRYPTION_KEY,
        });

        const composed = processMocks.secrets() as SecretService;
        expect(composed).toBeInstanceOf(SecretService);
        await expect(composed.list({ projectId: "project-1" })).resolves.toEqual([]);
        expect(databaseMocks.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { projectId: "project-1" } }),
        );
      });

      /** @scenario "One at-rest format for every process" */
      it("reads a stored row back with the key the deployment configured", async () => {
        databaseMocks.configured.value = true;
        databaseMocks.rows.push({
          name: "OPENAI_API_KEY",
          encryptedValue: AesGcmSecretEncryptionAdapter.create({
            key: ENCRYPTION_KEY,
          }).encrypt("sk-live-abc123"),
        });

        await composeWithout({
          DATABASE_URL: "postgresql://localhost/langwatch",
          CREDENTIALS_SECRET: ENCRYPTION_KEY,
        });

        const composed = processMocks.secrets() as SecretService;
        await expect(composed.getValues({ projectId: "project-1" })).resolves.toEqual({
          OPENAI_API_KEY: "sk-live-abc123",
        });
      });

      /** @scenario "A key that is not the key refuses rather than guesses" */
      it("refuses a row written under a different key rather than answering with rubbish", async () => {
        databaseMocks.configured.value = true;
        databaseMocks.rows.push({
          name: "OPENAI_API_KEY",
          encryptedValue: AesGcmSecretEncryptionAdapter.create({
            key: "a1".repeat(32),
          }).encrypt("sk-live-abc123"),
        });

        await composeWithout({
          DATABASE_URL: "postgresql://localhost/langwatch",
          CREDENTIALS_SECRET: ENCRYPTION_KEY,
        });

        const composed = processMocks.secrets() as SecretService;
        await expect(composed.getValues({ projectId: "project-1" })).rejects.toThrow(
          /OPENAI_API_KEY/,
        );
      });

      it("hides the product-owned names the contract reserves, as the platform app does", async () => {
        databaseMocks.configured.value = true;
        databaseMocks.rows.push({ name: LANGY_VK_SECRET_NAME, encryptedValue: "unused" });
        databaseMocks.rows.push({ name: "OPENAI_API_KEY", encryptedValue: "unused" });

        await composeWithout({
          DATABASE_URL: "postgresql://localhost/langwatch",
          CREDENTIALS_SECRET: ENCRYPTION_KEY,
        });

        const composed = processMocks.secrets() as SecretService;
        await expect(composed.list({ projectId: "project-1" })).resolves.toEqual([
          expect.objectContaining({ name: "OPENAI_API_KEY" }),
        ]);
      });
    });

    describe("when the deployment configured a key but no database", () => {
      it("composes no secret service, because a cipher is not a service", async () => {
        await composeWithout({ CREDENTIALS_SECRET: ENCRYPTION_KEY });

        expect(processMocks.secrets()).toBeUndefined();
      });
    });

    describe("when the deployment configured a database but no key", () => {
      it("composes no secret service rather than one that fails on every request", async () => {
        databaseMocks.configured.value = true;

        await composeWithout({ DATABASE_URL: "postgresql://localhost/langwatch" });

        expect(processMocks.secrets()).toBeUndefined();
      });

      /** @scenario "A process with no key composes no secret service" */
      it("mounts no secret door, so the route is absent rather than broken", async () => {
        databaseMocks.configured.value = true;

        await composeWithout({ DATABASE_URL: "postgresql://localhost/langwatch" });

        const rest = processMocks.rest();
        if (!rest) throw new Error("The production composition mounted no REST door at all.");

        expect(await rest.request("/api/v1/secret", { method: "GET" })).toHaveProperty(
          "status",
          404,
        );
      });

      it("still mounts the families that need neither the client nor the key", async () => {
        databaseMocks.configured.value = true;

        await composeWithout({ DATABASE_URL: "postgresql://localhost/langwatch" });

        const rest = processMocks.rest();
        if (!rest) throw new Error("The production composition mounted no REST door at all.");

        expect(
          await rest.request("/api/api-keys", {
            headers: { "X-Auth-Token": "token" },
          }),
        ).not.toHaveProperty("status", 404);
      });
    });
  });

  describe("given the metrics transport this process can now compose itself", () => {
    describe("when a host supplied one", () => {
      /** @scenario "An injected metrics transport answers every scrape" */
      it("hands the process the host's transport, whatever this deployment configured", async () => {
        const injected = new TestMetrics();

        await composeWithout(
          { METRICS_API_KEY: "a-key-this-process-never-uses" },
          {
            metrics: injected,
          },
        );

        expect(processMocks.metrics()).toBe(injected);
      });
    });

    describe("when the deployment configured a credential", () => {
      /** @scenario "An authenticated scrape renders what this process recorded" */
      it("composes its own, gated by that credential", async () => {
        await composeWithout({ METRICS_API_KEY: "scrape-me" });

        const composed = processMocks.metrics() as ApiMetricsPort;
        expect(composed).toBeInstanceOf(ApiMetricsPort);
        expect(await composed.respond(metricsScrape())).toHaveProperty("status", 401);
        expect(await composed.respond(metricsScrape("Bearer scrape-me"))).toHaveProperty(
          "status",
          200,
        );
      });
    });

    describe("when a production deployment configured no credential", () => {
      /** @scenario "In production an unset key leaves the process with no metrics endpoint" */
      it("composes no transport, so the process mounts no metrics route", async () => {
        await composeWithout({ NODE_ENV: "production" });

        expect(processMocks.metrics()).toBeUndefined();
      });
    });
  });
});

function metricsScrape(authorization?: string): Request {
  return new Request("http://api.test/metrics", {
    headers: authorization ? { authorization } : {},
  });
}

class TestMetrics extends ApiMetricsPort {
  async respond(): Promise<Response> {
    return new Response("langwatch_api_up 1", { status: 200 });
  }
}

function productionComposition(
  overrides: { secrets?: SecretService; metrics?: ApiMetricsPort } = {
    secrets: secretService().service,
  },
): ApiProductionComposition {
  return ApiProductionComposition.create({
    agents: new Proxy(AgentService.prototype, {}),
    ...(overrides.secrets ? { secrets: overrides.secrets } : {}),
    ...(overrides.metrics ? { metrics: overrides.metrics } : {}),
    apiKeys: apiKeyService(resolvedKey).service,
    authz: authzService(true).service,
    organizations: organizationService(),
    auth: new TestAuthComposition(),
  });
}

async function composeWithout(
  source: Readonly<Record<string, unknown>>,
  overrides: { metrics?: ApiMetricsPort } = {},
): Promise<ApiProductionComposition> {
  const composition = productionComposition(overrides);
  await composition.compose({
    config: resolveApiConfig({ NODE_ENV: "test", API_PORT: "5560", ...source }),
    graph: new TestGraph(),
    observability: { serviceName: "langwatch-api-test" },
    resources: new ResourceScope(),
  });
  return composition;
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
