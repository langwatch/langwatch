/**
 * The reach of one minted sandbox key (ADR: agent cache), proved against the real
 * permission set `AgentSandboxKeyMintService.mint` requests: exactly `agentCache:manage`, so a key
 * @see specs/agent-cache/agent-cache.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { requires } from "@langwatch/api";
import { AgentSandboxKeyMintService } from "@langwatch/api-key-server";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";

import { createAgentCacheRestApp, type AgentCacheStore } from "../agent-cache-rest";
import { AgentCacheService } from "../agent-cache.service";
import { MemoryAgentCacheEntryStore } from "../agent-cache.store";

const PROJECT_ID = "project_sandbox";

const fakeEncryption: SecretEncryptionPort = {
  encrypt: (value: string) => `sealed:${value}`,
  decrypt: (value: string) => value.slice("sealed:".length),
};

/** Captures the permission list the real mint function actually requested. */
function fakeApiKeys(): { apiKeys: ApiKeyService; grantedPermissions: () => string[] } {
  let granted: string[] = [];
  const apiKeys = {
    create: async (input: { permissions?: readonly string[] }) => {
      granted = [...(input.permissions ?? [])];
      return { token: "sandbox-token", apiKey: { id: "key_sandbox" } };
    },
  } as unknown as ApiKeyService;
  return { apiKeys, grantedPermissions: () => granted };
}

/** A security policy that authorizes exactly the permissions the sandbox key was minted with. */
function sandboxKeySecurity(grantedPermissions: readonly string[]): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    c.set("project", {
      id: PROJECT_ID,
      name: "Sandbox Project",
      slug: "sandbox-project",
      teamId: "team_1",
      organizationId: "org_1",
      isPersonal: false,
      ownerUserId: null,
    });
    await next();
  };
  const authorizeProjectPermission =
    (args: { permission: string }): MiddlewareHandler =>
    async (c, next) => {
      if (!grantedPermissions.includes(args.permission)) {
        return c.json({ error: "forbidden" }, 403);
      }
      await next();
      return undefined;
    };
  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: (error, c) => {
      const handled = error as { httpStatus?: number; message?: string };
      return c.json(
        { error: handled.message ?? String(error) },
        (handled.httpStatus ?? 500) as never,
      );
    },
    canonicalErrorHandler: (error, c) => {
      const handled = error as { httpStatus?: number; code?: string; message?: string };
      return c.json(
        { code: handled.code ?? "error", message: handled.message ?? String(error) },
        (handled.httpStatus ?? 500) as never,
      );
    },
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: (args) =>
      authorizeProjectPermission(args as { permission: string }),
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };
  return createAppRestSecurity(ports);
}

async function mintedPermissions(): Promise<string[]> {
  const { apiKeys, grantedPermissions } = fakeApiKeys();
  await AgentSandboxKeyMintService.mint({
    apiKeys,
    projectId: PROJECT_ID,
    organizationId: "org_1",
  });
  return grantedPermissions();
}

describe("given a key minted for the runs of a project", () => {
  /** @scenario "The sandbox key reaches the agent cache" */
  it("stores an entry and reads it back", async () => {
    const permissions = await mintedPermissions();
    const security = sandboxKeySecurity(permissions);
    const store = MemoryAgentCacheEntryStore.create();
    const service = new AgentCacheService(store, fakeEncryption);
    const agentCache: AgentCacheStore = {
      getByName: (input) => service.getByName(input),
      put: (input) => service.put(input),
      claim: (input) => service.claim(input),
      delete: (input) => service.delete(input),
    };
    const app = createAgentCacheRestApp({ security, agentCache: () => agentCache });

    const written = await app.hono.request("/api/agent-cache/ACME_SESSION", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "session-1" }),
    });
    expect(written.status).toBe(200);

    const read = await app.hono.request("/api/agent-cache/ACME_SESSION");
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ value: "session-1" });
  });

  /** @scenario "The sandbox key reaches nothing else" */
  it("is refused as forbidden calling a route that asks for a different grain", async () => {
    const permissions = await mintedPermissions();
    const security = sandboxKeySecurity(permissions);
    const other = security.createProjectApp({ basePath: "/api/other" });
    other.access(requires("project:view")).get("/", (c) => c.json({ ok: true }));

    const response = await other.hono.request("/api/other");

    expect(response.status).toBe(403);
  });
});
