/**
 * A minted sandbox key reaches the Gateway-owned agent-cache mount with the
 * one permission the mint grants.
 * @see specs/agent-cache/agent-cache.feature
 */
import type { ApiKey, ApiKeyApi } from "@langwatch/api-key-contract";
import {
  AgentSandboxKeyMintService,
  RedisAgentSandboxKeyShareAdapter,
} from "@langwatch/api-key-server";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { composeGatewayAgentCache, installApiGateway } from "../../gateway/gateway.composition.ts";
import { mountGatewayAgentCacheRest } from "../../gateway/gateway-rest.mount.ts";

const PROJECT = {
  id: "project-sandbox",
  slug: "sandbox-project",
  teamId: "team-sandbox",
  organizationId: "organization-sandbox",
  isPersonal: false,
  ownerUserId: null,
};
const SHARE_SECRET = "a".repeat(64);
const encryption: SecretEncryptionPort = {
  encrypt: (value: string) => `sealed:${value}`,
  decrypt: (value: string) => value.slice("sealed:".length),
};

function apiKeyRow(input: {
  id: string;
  organizationId: string;
  userId: string | null;
  createdByUserId: string | null;
}): ApiKey {
  const now = new Date("2026-09-01T10:00:00.000Z");
  return {
    id: input.id,
    name: "Sandbox key",
    description: null,
    organizationId: input.organizationId,
    userId: input.userId,
    createdByUserId: input.createdByUserId,
    createdByDeviceLabel: null,
    lookupId: `lookup-${input.id}`,
    permissionMode: "restricted",
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: now,
    updatedAt: now,
    roleBindings: [],
  };
}

function fakeApiKeys(): {
  apiKeys: ApiKeyApi;
  grantedPermissions: () => AuthzPermission[];
  minted: () => { userId: string | null; createdByUserId: string | null }[];
} {
  let granted: AuthzPermission[] = [];
  const minted: { userId: string | null; createdByUserId: string | null }[] = [];
  const apiKeys = createApiFixture<ApiKeyApi>({
    create: async (input) => {
      granted = [...(input.permissions ?? [])];
      const owners = {
        userId: input.userId ?? null,
        createdByUserId: input.createdByUserId ?? null,
      };
      minted.push(owners);
      const id = `key-sandbox-${minted.length}`;
      return {
        token: `sandbox-token-${minted.length}`,
        apiKey: apiKeyRow({ id, organizationId: input.organizationId, ...owners }),
      };
    },
  });

  return { apiKeys, grantedPermissions: () => granted, minted: () => minted };
}

function mintOver(options: { apiKeys: ApiKeyApi; ownerUserId?: string }) {
  return AgentSandboxKeyMintService.create({
    apiKeys: options.apiKeys,
    projects: {
      findPersonalWorkspaceOwner: async () =>
        options.ownerUserId ? { ownerUserId: options.ownerUserId } : null,
    },
    share: RedisAgentSandboxKeyShareAdapter.create({ redis: null, secret: SHARE_SECRET }),
  });
}

async function agentCacheApp(grantedPermissions: readonly AuthzPermission[]) {
  const errors = ApiRestObservabilityComposition.create().canonicalErrorHandler;
  const runtime = createApiRestRuntime({
    projectCredential: async ({ permission }) => {
      if (!grantedPermissions.includes(permission)) {
        return { ok: false as const, status: 403 as const, body: { error: "Forbidden" } };
      }

      return {
        ok: true as const,
        project: PROJECT,
        resolved: {
          type: "apiKey" as const,
          apiKeyId: "key-sandbox",
          userId: null,
          organizationId: PROJECT.organizationId,
          ingestSourceType: null,
          ingestionTemplateId: null,
          project: PROJECT,
        },
        markUsed: () => void 0,
      };
    },
    organizationCredential: () => {
      throw new Error("This suite opens no organization credential door");
    },
    organizationIdentity: () => {
      throw new Error("This suite opens no organization credential door");
    },
    routeAuthorization: async () => ({ permitted: true, organizationRole: null }),
    errors,
  });
  const agentCache = composeGatewayAgentCache({ encryption, redis: void 0 });
  const gateway = await installApiGateway({
    infrastructure: void 0,
    peers: void 0,
    clickhouse: null,
    virtualKeyPepper: void 0,
    agentCache,
  });
  const service = gateway.restServices.agentCache;
  if (!service) throw new Error("The cache infrastructure did not install its REST service");

  return mountGatewayAgentCacheRest(runtime, service);
}

async function roundTripEntry(app: Awaited<ReturnType<typeof agentCacheApp>>, name: string) {
  const written = await app.request(`/api/agent-cache/${name}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: `value-of-${name}` }),
  });
  const read = await app.request(`/api/agent-cache/${name}`);
  return { written, read };
}

async function mintedPermissions(): Promise<AuthzPermission[]> {
  const { apiKeys, grantedPermissions } = fakeApiKeys();
  await mintOver({ apiKeys }).mint({
    projectId: PROJECT.id,
    organizationId: PROJECT.organizationId,
  });
  return grantedPermissions();
}

describe("given a key minted for the runs of a project", () => {
  /** @scenario "The sandbox key reaches the agent cache" */
  it("stores an entry and reads it back through the production mount", async () => {
    const app = await agentCacheApp(await mintedPermissions());

    const { written, read } = await roundTripEntry(app, "ACME_SESSION");

    expect(written.status).toBe(200);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ value: "value-of-ACME_SESSION" });
  });

  /** @scenario "The sandbox key reaches nothing else" */
  it("is granted only the agent-cache manage permission", async () => {
    expect(await mintedPermissions()).toEqual(["agentCache:manage"]);
  });
});

describe("given a run of this project already got a key", () => {
  describe("when a later run of the same project asks for one", () => {
    /** @scenario "A later run in the same project reuses the key" */
    it("reuses the key and still reaches the cache", async () => {
      const { apiKeys, grantedPermissions, minted } = fakeApiKeys();
      const mint = mintOver({ apiKeys });

      const first = await mint.getOrMint({
        projectId: PROJECT.id,
        organizationId: PROJECT.organizationId,
      });
      const second = await mint.getOrMint({
        projectId: PROJECT.id,
        organizationId: PROJECT.organizationId,
      });

      expect(second).toBe(first);
      expect(minted()).toHaveLength(1);
      const { written, read } = await roundTripEntry(
        await agentCacheApp(grantedPermissions()),
        "ACME_FROM_SHARED_KEY",
      );
      expect(written.status).toBe(200);
      expect(read.status).toBe(200);
    });
  });
});

describe("given a project in a personal workspace", () => {
  describe("when a run of that project mints its key", () => {
    /** @scenario "A run in a personal workspace gets a key its owner holds" */
    it("belongs to the workspace owner and reaches that project's cache", async () => {
      const { apiKeys, grantedPermissions, minted } = fakeApiKeys();

      await mintOver({ apiKeys, ownerUserId: "owner-1" }).getOrMint({
        projectId: PROJECT.id,
        organizationId: PROJECT.organizationId,
      });

      expect(minted()).toEqual([{ userId: "owner-1", createdByUserId: "owner-1" }]);
      const { written, read } = await roundTripEntry(
        await agentCacheApp(grantedPermissions()),
        "ACME_PERSONAL",
      );
      expect(written.status).toBe(200);
      expect(read.status).toBe(200);
    });
  });
});
