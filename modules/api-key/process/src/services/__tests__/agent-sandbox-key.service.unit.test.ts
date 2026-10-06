/**
 * The key a project's code agent runs share: the agent cache alone for twelve hours, held sealed
 * for eight, nobody's in a shared project and the owner's in a personal workspace.
 *
 * @see specs/agent-cache/agent-cache.feature
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSandboxKeyCipher } from "../../repositories/agent-sandbox-key.repository.ts";
import { MemoryAgentSandboxKeyRepository } from "../../repositories/memory/memory.agent-sandbox-key.repository.ts";
import { RedisAgentSandboxKeyRepository } from "../../repositories/redis/redis.agent-sandbox-key.repository.ts";
import {
  AGENT_SANDBOX_KEY_REUSE_MS,
  AGENT_SANDBOX_KEY_TTL_MS,
} from "../../rules/agent-sandbox-key.rules.ts";
import { AgentSandboxKeyService } from "../agent-sandbox-key.service.ts";

const projectId = "project-1";
const startedAt = new Date("2026-10-06T10:00:00.000Z");

const cipher: AgentSandboxKeyCipher = {
  encrypt: (plaintext) => `sealed:${plaintext}`,
  decrypt: (ciphertext) => {
    if (!ciphertext.startsWith("sealed:")) throw new Error("not sealed by this cipher");
    return ciphertext.slice("sealed:".length);
  },
};

function createService({
  personal = null,
  held = MemoryAgentSandboxKeyRepository.create(),
}: {
  personal?: { ownerUserId: string | null } | null;
  held?: MemoryAgentSandboxKeyRepository | RedisAgentSandboxKeyRepository;
} = {}) {
  const created: Parameters<ApiKeyApi["create"]>[0][] = [];
  const create = vi.fn();
  create.mockImplementation(async (input: Parameters<ApiKeyApi["create"]>[0]) => {
    created.push(input);
    return { token: `token-${created.length}`, apiKey: { id: `key-${created.length}` } };
  });
  const service = AgentSandboxKeyService.create({
    apiKeys: createApiFixture<ApiKeyApi>({ create }),
    authz: createApiFixture<AuthzApi>({
      getScope: vi.fn().mockResolvedValue({
        type: "project",
        id: projectId,
        teamId: "team-1",
        organizationId: "org-1",
      }),
    }),
    projects: createApiFixture<ProjectApi>({
      findPersonalWorkspaceOwner: vi.fn().mockResolvedValue(personal),
    }),
    held,
  });

  return { service, created };
}

describe("AgentSandboxKeyService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a project in a shared team", () => {
    /** @scenario "A run in a shared project gets a key no user holds" */
    it("mints a key no user holds, reaching the agent cache alone for twelve hours", async () => {
      const { service, created } = createService();

      await service.mintAgentSandboxKey({ projectId });

      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        isSystemManaged: true,
        name: "Agent sandbox run",
        userId: null,
        createdByUserId: null,
        organizationId: "org-1",
        permissionMode: "restricted",
        permissions: ["agentCache:manage"],
        bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
      });
      expect(created[0]?.parentApiKeyId ?? null).toBeNull();
      expect(created[0]?.expiresAt?.getTime()).toBe(startedAt.getTime() + AGENT_SANDBOX_KEY_TTL_MS);
    });
  });

  describe("given a project in a personal workspace", () => {
    it("mints the key as the workspace owner's own", async () => {
      const { service, created } = createService({ personal: { ownerUserId: "owner-1" } });

      await service.mintAgentSandboxKey({ projectId });

      expect(created[0]).toMatchObject({ userId: "owner-1", createdByUserId: "owner-1" });
    });

    it("refuses, and mints nothing, when the workspace has no recorded owner", async () => {
      const { service, created } = createService({ personal: { ownerUserId: null } });

      await expect(service.mintAgentSandboxKey({ projectId })).rejects.toMatchObject({
        code: "api_key_scope_violation",
      });
      expect(created).toHaveLength(0);
    });
  });

  describe("given a key already shared by the project's runs", () => {
    it("hands later runs the same key for eight hours, then mints the next", async () => {
      const { service, created } = createService();

      const first = await service.mintAgentSandboxKey({ projectId });
      vi.setSystemTime(startedAt.getTime() + AGENT_SANDBOX_KEY_REUSE_MS - 1);
      const later = await service.mintAgentSandboxKey({ projectId });
      vi.setSystemTime(startedAt.getTime() + AGENT_SANDBOX_KEY_REUSE_MS);
      const next = await service.mintAgentSandboxKey({ projectId });

      expect(later).toBe(first);
      expect(next).not.toBe(first);
      expect(created).toHaveLength(2);
    });
  });

  describe("given a held token the platform can no longer read", () => {
    /** @scenario "A shared key the platform can no longer read is replaced" */
    it("mints a new key and shares it from then on", async () => {
      const redis = memoryRedisDouble();
      await redis.set(`ttlcache:agent-sandbox-key:${projectId}`, JSON.stringify("damaged"));
      const held = RedisAgentSandboxKeyRepository.create({ redis, cipher });
      const { service, created } = createService({ held });

      const replaced = await service.mintAgentSandboxKey({ projectId });
      const shared = await service.mintAgentSandboxKey({ projectId });

      expect(created).toHaveLength(1);
      expect(shared).toBe(replaced);
    });
  });
});
