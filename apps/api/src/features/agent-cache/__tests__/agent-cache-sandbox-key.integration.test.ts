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
import {
  AgentSandboxKeyMintService,
  RedisAgentSandboxKeyShareAdapter,
} from "@langwatch/api-key-server";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";

import { createAgentCacheRestApp, type AgentCacheStore } from "../agent-cache-rest.ts";
import { AgentCacheService } from "../agent-cache.service.ts";
import { MemoryAgentCacheEntryStore } from "../agent-cache.store.ts";

const PROJECT_ID = "project_sandbox";
/** A 32-byte hex key, the shape the share adapter refuses anything else in place of. */
const SHARE_SECRET = "a".repeat(64);

const fakeEncryption: SecretEncryptionPort = {
  encrypt: (value: string) => `sealed:${value}`,
  decrypt: (value: string) => value.slice("sealed:".length),
};

/** Captures the permission list the real mint function actually requested. */
function fakeApiKeys(): {
  apiKeys: ApiKeyApi;
  grantedPermissions: () => string[];
  minted: () => { userId: string | null; createdByUserId: string | null }[];
} {
  let granted: string[] = [];
  const minted: { userId: string | null; createdByUserId: string | null }[] = [];
  const apiKeys = {
    create: async (input: {
      permissions?: readonly string[];
      userId?: string | null;
      createdByUserId?: string | null;
    }) => {
      granted = [...(input.permissions ?? [])];
      minted.push({
        userId: input.userId ?? null,
        createdByUserId: input.createdByUserId ?? null,
      });
      return { token: `sandbox-token-${minted.length}`, apiKey: { id: "key_sandbox" } };
    },
  } as unknown as ApiKeyApi;
  return { apiKeys, grantedPermissions: () => granted, minted: () => minted };
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

/**
 * The mint as a process composes it: the real share adapter over no Redis (so
 * the share is this process's own, sealed the same way), and a project
 * directory that answers who - if anyone - owns the workspace the project
 * sits in.
 */
function mintOver(options: { apiKeys: ApiKeyApi; ownerUserId?: string }) {
  return AgentSandboxKeyMintService.create({
    apiKeys: options.apiKeys,
    projects: {
      findPersonalWorkspaceOwner: async () =>
        options.ownerUserId ? { ownerUserId: options.ownerUserId } : null,
    },
    share: RedisAgentSandboxKeyShareAdapter.create({
      redis: null,
      secret: SHARE_SECRET,
    }),
  });
}

/** A cache the sandbox key's grants are enforced against, over the real REST family. */
function agentCacheApp(security: AppRestSecurity) {
  const service = new AgentCacheService(MemoryAgentCacheEntryStore.create(), fakeEncryption);
  const agentCache: AgentCacheStore = {
    getByName: (input) => service.getByName(input),
    put: (input) => service.put(input),
    claim: (input) => service.claim(input),
    delete: (input) => service.delete(input),
  };
  return createAgentCacheRestApp({ security, agentCache: () => agentCache }).hono;
}

async function roundTripEntry(hono: ReturnType<typeof agentCacheApp>, name: string) {
  const written = await hono.request(`/api/agent-cache/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: `value-of-${name}` }),
  });
  const read = await hono.request(`/api/agent-cache/${name}`);
  return { written, read };
}

async function mintedPermissions(): Promise<string[]> {
  const { apiKeys, grantedPermissions } = fakeApiKeys();
  await mintOver({ apiKeys }).mint({
    projectId: PROJECT_ID,
    organizationId: "org_1",
  });
  return grantedPermissions();
}

describe("given a key minted for the runs of a project", () => {
  /** @scenario "The sandbox key reaches the agent cache" */
  it("stores an entry and reads it back", async () => {
    const hono = agentCacheApp(sandboxKeySecurity(await mintedPermissions()));

    const { written, read } = await roundTripEntry(hono, "ACME_SESSION");

    expect(written.status).toBe(200);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ value: "value-of-ACME_SESSION" });
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

describe("given a run of this project already got a key", () => {
  describe("when a later run of the same project asks for one", () => {
    /** @scenario "A later run in the same project reuses the key" */
    it("is given the same key, no second key is minted, and it still reaches the cache", async () => {
      const { apiKeys, grantedPermissions, minted } = fakeApiKeys();
      const mint = mintOver({ apiKeys });

      const first = await mint.getOrMint({ projectId: PROJECT_ID, organizationId: "org_1" });
      const second = await mint.getOrMint({ projectId: PROJECT_ID, organizationId: "org_1" });

      expect(second).toBe(first);
      expect(minted()).toHaveLength(1);

      const hono = agentCacheApp(sandboxKeySecurity(grantedPermissions()));
      const { written, read } = await roundTripEntry(hono, "ACME_FROM_SHARED_KEY");
      expect(written.status).toBe(200);
      expect(read.status).toBe(200);
    });
  });
});

describe("given a project in a personal workspace", () => {
  describe("when a run of that project mints its key", () => {
    /** @scenario "A run in a personal workspace gets a key its owner holds" */
    it("belongs to the workspace owner and reaches that project's cache", async () => {
      // A key owned by nobody is a second principal in a personal workspace and
      // the grant policy refuses it there, so the run's key is the owner's own.
      const { apiKeys, grantedPermissions, minted } = fakeApiKeys();

      await mintOver({ apiKeys, ownerUserId: "owner_1" }).getOrMint({
        projectId: PROJECT_ID,
        organizationId: "org_1",
      });

      expect(minted()).toEqual([{ userId: "owner_1", createdByUserId: "owner_1" }]);

      const hono = agentCacheApp(sandboxKeySecurity(grantedPermissions()));
      const { written, read } = await roundTripEntry(hono, "ACME_PERSONAL");
      expect(written.status).toBe(200);
      expect(read.status).toBe(200);
    });
  });
});
