import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import {
  AgentSandboxKeyUnreadableError,
  type AgentSandboxKeyCipher,
} from "../../agent-sandbox-key.repository.ts";
import { RedisAgentSandboxKeyRepository } from "../redis.agent-sandbox-key.repository.ts";

/** A reversible stand-in for the process's cipher; it refuses anything it did not seal. */
const cipher: AgentSandboxKeyCipher = {
  encrypt: (plaintext) => `sealed:${Buffer.from(plaintext).toString("base64")}`,
  decrypt: (ciphertext) => {
    if (!ciphertext.startsWith("sealed:")) throw new Error("not sealed by this cipher");
    return Buffer.from(ciphertext.slice("sealed:".length), "base64").toString();
  },
};

const storedKey = "ttlcache:agent-sandbox-key:project-1";

describe("RedisAgentSandboxKeyRepository", () => {
  describe("when a token is held", () => {
    it("rests sealed under main's key for the window, and reads back as the token", async () => {
      const redis = memoryRedisDouble();
      const held = RedisAgentSandboxKeyRepository.create({ redis, cipher });

      await held.hold({ projectId: "project-1", token: "content-marker", ttlMs: 8 * 3_600_000 });

      expect(await redis.get(storedKey)).toBe(JSON.stringify(cipher.encrypt("content-marker")));
      expect(await redis.ttl(storedKey)).toBe(8 * 3_600);
      await expect(held.findTokens({ projectId: "project-1" })).resolves.toEqual([
        "content-marker",
      ]);
    });
  });

  describe("when nothing is held", () => {
    it("answers no token", async () => {
      const held = RedisAgentSandboxKeyRepository.create({ redis: memoryRedisDouble(), cipher });

      await expect(held.findTokens({ projectId: "project-1" })).resolves.toEqual([]);
    });
  });

  describe("when the held value cannot be opened", () => {
    it("refuses with the unreadable error rather than answering it", async () => {
      const redis = memoryRedisDouble();
      await redis.set(storedKey, JSON.stringify("damaged"));
      const held = RedisAgentSandboxKeyRepository.create({ redis, cipher });

      await expect(held.findTokens({ projectId: "project-1" })).rejects.toBeInstanceOf(
        AgentSandboxKeyUnreadableError,
      );
    });
  });
});
