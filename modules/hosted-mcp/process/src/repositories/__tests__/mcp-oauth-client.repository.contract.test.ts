import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import type { McpOAuthClientRepository } from "../mcp-oauth-client.repository.ts";
import { MemoryMcpOAuthClientRepository } from "../memory/memory.mcp-oauth-client.repository.ts";
import { RedisMcpOAuthClientRepository } from "../redis/redis.mcp-oauth-client.repository.ts";

const TIERS: readonly [string, () => McpOAuthClientRepository][] = [
  ["redis", () => RedisMcpOAuthClientRepository.create({ redis: memoryRedisDouble() })],
  ["memory", () => MemoryMcpOAuthClientRepository.create()],
];

const CLIENT = { redirectUris: ["http://127.0.0.1:9999/cb"], clientName: "Claude Desktop" };

describe.each(TIERS)("the %s MCP OAuth client registry", (_tier, build) => {
  describe("given a registered client", () => {
    it("reads the registration back by its client_id", async () => {
      const clients = build();
      await clients.register({ clientId: "client-1", client: CLIENT });

      await expect(clients.getByClientId({ clientId: "client-1" })).resolves.toEqual({
        kind: "registered",
        client: CLIENT,
      });
    });
  });

  describe("given a client_id nobody registered", () => {
    it("reads it as unregistered", async () => {
      await expect(build().getByClientId({ clientId: "never" })).resolves.toEqual({
        kind: "unregistered",
      });
    });
  });
});

describe("the redis MCP OAuth client registry with no Redis configured", () => {
  it("refuses a registration and reads every client as unregistered", async () => {
    const clients = RedisMcpOAuthClientRepository.create({ redis: null });

    await expect(clients.register({ clientId: "client-1", client: CLIENT })).rejects.toThrow(
      "Redis is not available",
    );
    await expect(clients.getByClientId({ clientId: "client-1" })).resolves.toEqual({
      kind: "unregistered",
    });
  });
});
