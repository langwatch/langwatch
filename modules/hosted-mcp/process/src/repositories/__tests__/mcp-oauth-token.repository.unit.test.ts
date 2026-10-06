import type { McpAuthorizationCodeRecord } from "@langwatch/hosted-mcp-contract";
import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import type { McpOAuthTokenRepository } from "../mcp-oauth-token.repository.ts";
import { MemoryMcpOAuthClientRepository } from "../memory/memory.mcp-oauth-client.repository.ts";
import { MemoryMcpOAuthTokenRepository } from "../memory/memory.mcp-oauth-token.repository.ts";
import { RedisMcpOAuthClientRepository } from "../redis/redis.mcp-oauth-client.repository.ts";
import { RedisMcpOAuthTokenRepository } from "../redis/redis.mcp-oauth-token.repository.ts";

type Tier = Readonly<{
  codes: McpOAuthTokenRepository;
  register: (clientId: string) => Promise<void>;
}>;

const CLIENT = { redirectUris: ["http://127.0.0.1:9999/cb"], clientName: "Claude Desktop" };

/** A Redis whose keyspace answers `GETDEL`, the one command code consumption adds. */
function redisTier(): Tier {
  const store = memoryRedisStore();
  const redis = memoryRedisDouble({
    store,
    script: {
      call: async (command: unknown, key: unknown) => {
        if (command !== "GETDEL") throw new Error(`unscripted ${String(command)}`);
        const value = store.strings.get(String(key)) ?? null;
        store.strings.delete(String(key));
        return value;
      },
    },
  });
  const clients = RedisMcpOAuthClientRepository.create({ redis });
  return {
    codes: RedisMcpOAuthTokenRepository.create({ redis }),
    register: (clientId) => clients.register({ clientId, client: CLIENT }),
  };
}

function memoryTier(): Tier {
  const clients = MemoryMcpOAuthClientRepository.create();
  return {
    codes: MemoryMcpOAuthTokenRepository.create({ clients }),
    register: (clientId) => clients.register({ clientId, client: CLIENT }),
  };
}

const RECORD: McpAuthorizationCodeRecord = {
  projectId: "project-1",
  organizationId: "organization-1",
  userId: "user-1",
  codeChallenge: "challenge",
  codeChallengeMethod: "S256",
  redirectUri: "http://127.0.0.1:9999/cb",
  clientId: "client-1",
  expiresAt: 1,
};

describe.each([
  ["redis", redisTier],
  ["memory", memoryTier],
] as const)("the %s MCP authorization codes", (_tier, build) => {
  describe("given a stored code", () => {
    it("hands the record back once, then reads the code as missing", async () => {
      const { codes } = build();
      await codes.storeAuthorizationCode({ code: "code-1", record: RECORD, ttlSeconds: 60 });

      expect(codes.isAvailable()).toBe(true);
      await expect(codes.consumeAuthorizationCode({ code: "code-1" })).resolves.toEqual({
        kind: "found",
        record: RECORD,
      });
      await expect(codes.consumeAuthorizationCode({ code: "code-1" })).resolves.toEqual({
        kind: "missing",
      });
    });
  });

  describe("given a client registered through the client records", () => {
    it("answers that the client is registered and another is not", async () => {
      const { codes, register } = build();
      await register("client-1");

      await expect(codes.hasRegisteredClient({ clientId: "client-1" })).resolves.toBe(true);
      await expect(codes.hasRegisteredClient({ clientId: "client-2" })).resolves.toBe(false);
    });
  });
});
