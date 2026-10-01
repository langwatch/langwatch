import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import type { McpSessionRepository } from "../mcp-session.repository.ts";
import { MemoryMcpSessionRepository } from "../memory/memory.mcp-session.repository.ts";
import { RedisMcpSessionRepository } from "../redis/redis.mcp-session.repository.ts";

/** A Redis whose keyspace answers `exists`, the one command session counting adds. */
function redisTier(): McpSessionRepository {
  const store = memoryRedisStore();
  const redis = memoryRedisDouble({
    store,
    script: {
      exists: async (...keys: unknown[]) =>
        keys.filter((key) => typeof key === "string" && store.strings.has(key)).length,
    },
  });
  return RedisMcpSessionRepository.create({ redis });
}

const TIERS: readonly [string, () => McpSessionRepository][] = [
  ["redis", redisTier],
  ["memory", () => MemoryMcpSessionRepository.create()],
];

describe.each(TIERS)("the %s MCP session records", (_tier, build) => {
  describe("given a Streamable session recorded for a key", () => {
    it("reads the encrypted key back for that transport only", async () => {
      const records = build();
      await records.store({
        transport: "streamable",
        sessionId: "session-1",
        apiKey: "key-a",
        encryptedApiKey: "sealed-a",
      });

      expect(records.isAvailable()).toBe(true);
      await expect(
        records.getRecord({ transport: "streamable", sessionId: "session-1" }),
      ).resolves.toEqual({ kind: "found", encryptedApiKey: "sealed-a" });
      await expect(
        records.getRecord({ transport: "sse", sessionId: "session-1" }),
      ).resolves.toEqual({ kind: "missing" });
    });

    it("reads missing once the record is removed", async () => {
      const records = build();
      await records.store({
        transport: "streamable",
        sessionId: "session-1",
        apiKey: "key-a",
        encryptedApiKey: "sealed-a",
      });
      await records.touch({ transport: "streamable", sessionId: "session-1", apiKey: "key-a" });
      await records.remove({ transport: "streamable", sessionId: "session-1", apiKey: "key-a" });

      await expect(
        records.getRecord({ transport: "streamable", sessionId: "session-1" }),
      ).resolves.toEqual({ kind: "missing" });
    });
  });

  describe("given sessions of both transports across two keys", () => {
    it("counts one key's live sessions of either transport, and drops a removed one", async () => {
      const records = build();
      const open = (transport: "streamable" | "sse", sessionId: string, apiKey: string) =>
        records.store({ transport, sessionId, apiKey, encryptedApiKey: `sealed-${apiKey}` });
      await open("streamable", "s-1", "key-a");
      await open("sse", "s-2", "key-a");
      await open("streamable", "s-3", "key-b");

      await expect(records.countLive({ apiKey: "key-a" })).resolves.toBe(2);

      await records.remove({ transport: "sse", sessionId: "s-2", apiKey: "key-a" });

      await expect(records.countLive({ apiKey: "key-a" })).resolves.toBe(1);
      await expect(records.countLive({ apiKey: "key-b" })).resolves.toBe(1);
    });
  });
});

describe("the redis MCP session records with no Redis configured", () => {
  it("keeps nothing and reads every session as missing", async () => {
    const records = RedisMcpSessionRepository.create({ redis: null });
    await records.store({
      transport: "sse",
      sessionId: "session-1",
      apiKey: "key-a",
      encryptedApiKey: "sealed-a",
    });

    expect(records.isAvailable()).toBe(false);
    await expect(records.getRecord({ transport: "sse", sessionId: "session-1" })).resolves.toEqual({
      kind: "missing",
    });
    await expect(records.countLive({ apiKey: "key-a" })).resolves.toBe(0);
  });
});
