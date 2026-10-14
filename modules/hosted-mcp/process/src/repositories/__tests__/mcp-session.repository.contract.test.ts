import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import type { McpSessionCipher, McpSessionRepository } from "../mcp-session.repository.ts";
import { MemoryMcpSessionRepository } from "../memory/memory.mcp-session.repository.ts";
import { RedisMcpSessionRepository } from "../redis/redis.mcp-session.repository.ts";

/** A reversible seal a test can read at rest. */
const sealing: McpSessionCipher = {
  encrypt: (plaintext) => `sealed:${plaintext}`,
  decrypt: (ciphertext) => ciphertext.replace(/^sealed:/, ""),
};

function redisTier(store = memoryRedisStore()): McpSessionRepository {
  return RedisMcpSessionRepository.create({ redis: memoryRedisDouble({ store }), cipher: sealing });
}

const TIERS: readonly [string, () => McpSessionRepository][] = [
  ["redis", redisTier],
  ["memory", () => MemoryMcpSessionRepository.create()],
];

describe.each(TIERS)("the %s MCP session records", (_tier, build) => {
  describe("given a session recorded for a key", () => {
    it("reads the key, project and person back", async () => {
      const records = build();
      await records.store({
        sessionId: "session-1",
        apiKey: "key-a",
        projectId: "project-1",
        userId: "user-1",
      });

      expect(records.isAvailable()).toBe(true);
      await expect(records.getRecord({ sessionId: "session-1" })).resolves.toMatchObject({
        kind: "found",
        apiKey: "key-a",
        projectId: "project-1",
        userId: "user-1",
      });
      await expect(records.getRecord({ sessionId: "session-2" })).resolves.toEqual({
        kind: "missing",
      });
    });

    it("reads missing once the client removes it", async () => {
      const records = build();
      await records.store({ sessionId: "session-1", apiKey: "key-a" });
      await records.touch({ sessionId: "session-1", apiKey: "key-a" });
      await records.remove({ sessionId: "session-1", apiKey: "key-a" });

      await expect(records.getRecord({ sessionId: "session-1" })).resolves.toEqual({
        kind: "missing",
      });
      await expect(records.countActive({ apiKey: "key-a", since: 0 })).resolves.toBe(0);
    });
  });

  describe("given sessions across two keys", () => {
    it("counts one key's sessions active since a moment", async () => {
      const records = build();
      await records.store({ sessionId: "s-1", apiKey: "key-a" });
      await records.store({ sessionId: "s-2", apiKey: "key-a" });
      await records.store({ sessionId: "s-3", apiKey: "key-b" });

      await expect(records.countActive({ apiKey: "key-a", since: 0 })).resolves.toBe(2);
      await expect(records.countActive({ apiKey: "key-b", since: 0 })).resolves.toBe(1);
      await expect(
        records.countActive({ apiKey: "key-a", since: Date.now() + 60_000 }),
      ).resolves.toBe(0);
    });
  });

  describe("given a session moved to a refreshed token", () => {
    it("counts it under the new key only, and keeps the record", async () => {
      const records = build();
      await records.store({ sessionId: "s-1", apiKey: "token-old", userId: "user-1" });
      await records.rewrite({ sessionId: "s-1", apiKey: "token-new", userId: "user-1" });
      await records.forgetKey({ sessionId: "s-1", apiKey: "token-old" });

      await expect(records.countActive({ apiKey: "token-old", since: 0 })).resolves.toBe(0);
      await expect(records.countActive({ apiKey: "token-new", since: 0 })).resolves.toBe(1);
      await expect(records.getRecord({ sessionId: "s-1" })).resolves.toMatchObject({
        kind: "found",
        apiKey: "token-new",
      });
    });
  });

  describe("given a session the client already removed", () => {
    /** @scenario "A late rewrite never brings back a session the client ended" */
    it("does not bring the record back for a late refreshed-token rewrite", async () => {
      const records = build();
      await records.store({ sessionId: "s-1", apiKey: "token-old", userId: "user-1" });
      await records.remove({ sessionId: "s-1", apiKey: "token-old" });
      await records.rewrite({ sessionId: "s-1", apiKey: "token-new", userId: "user-1" });

      await expect(records.getRecord({ sessionId: "s-1" })).resolves.toEqual({ kind: "missing" });
      await expect(records.countActive({ apiKey: "token-new", since: 0 })).resolves.toBe(0);
    });
  });

  describe("given a session id already recorded", () => {
    it("leaves the recorded session as it is", async () => {
      const records = build();
      await records.store({ sessionId: "s-1", apiKey: "key-a", projectId: "project-1" });
      await records.store({ sessionId: "s-1", apiKey: "key-b", projectId: "project-2" });

      await expect(records.getRecord({ sessionId: "s-1" })).resolves.toMatchObject({
        kind: "found",
        apiKey: "key-a",
        projectId: "project-1",
      });
    });
  });
});

describe("the redis MCP session records' lifetime", () => {
  /** @scenario "Neither use nor a refreshed token extends a session's record" */
  it("ends a session 30 days after it opened, however much it is used", async () => {
    const store = memoryRedisStore();
    const records = redisTier(store);
    await records.store({ sessionId: "s-1", apiKey: "token-old", userId: "user-1" });
    const opened = await records.getRecord({ sessionId: "s-1" });
    expect(opened).toMatchObject({ kind: "found" });
    const thirtyDays = 30 * 24 * 3600 * 1000;
    expect(opened.kind === "found" && opened.expiresAt - Date.now()).toBeGreaterThan(
      thirtyDays - 60_000,
    );

    // Ten seconds left: neither use nor a refreshed token buys it more.
    store.expiries.set("mcp:session:s-1", 10_000);
    await records.touch({ sessionId: "s-1", apiKey: "token-old" });
    await records.rewrite({ sessionId: "s-1", apiKey: "token-new", userId: "user-1" });
    const later = await records.getRecord({ sessionId: "s-1" });

    expect(later).toMatchObject({ kind: "found", apiKey: "token-new" });
    expect(later.kind === "found" && later.expiresAt - Date.now()).toBeLessThanOrEqual(10_000);
  });
});

describe("the redis MCP session records at rest", () => {
  it("holds the key sealed under main's record layout", async () => {
    const store = memoryRedisStore();
    const records = redisTier(store);
    await records.store({ sessionId: "session-1", apiKey: "key-a", projectId: "project-1" });

    expect(JSON.parse(store.strings.get("mcp:session:session-1") ?? "{}")).toMatchObject({
      encryptedApiKey: "sealed:key-a",
      projectId: "project-1",
    });
  });
});

describe("the redis MCP session records with no Redis configured", () => {
  it("keeps nothing and reads every session as missing", async () => {
    const records = RedisMcpSessionRepository.create({ redis: null, cipher: sealing });
    await records.store({ sessionId: "session-1", apiKey: "key-a" });

    expect(records.isAvailable()).toBe(false);
    await expect(records.getRecord({ sessionId: "session-1" })).resolves.toEqual({
      kind: "missing",
    });
    await expect(records.countActive({ apiKey: "key-a", since: 0 })).resolves.toBe(0);
  });
});
