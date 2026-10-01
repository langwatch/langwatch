/**
 * The share a project's runs hold their sandbox key in, as main's TtlCache held it: sealed with
 * the deployment's cipher, JSON in Redis under `ttlcache:agent-sandbox-key:`, memory without Redis.
 * Spec: specs/agent-cache/agent-cache.feature
 */
import { describe, expect, it } from "vitest";

import {
  RedisAgentSandboxKeyShareRepository,
  type AgentSandboxKeySealing,
  type AgentSandboxKeyShareRedis,
} from "../redis.agent-sandbox-key-share.repository.ts";

/** A reversible stand-in for the deployment cipher. */
const sealing: AgentSandboxKeySealing = {
  encrypt: (plaintext) => `sealed(${plaintext})`,
  decrypt: (ciphertext) => {
    const match = /^sealed\((.*)\)$/.exec(ciphertext);
    if (!match?.[1]) throw new Error("not sealed by this cipher");
    return match[1];
  },
};

/** The two Redis calls the share makes, over a map. */
class RedisValues implements AgentSandboxKeyShareRedis {
  readonly values = new Map<string, { value: string; seconds: number }>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key)?.value ?? null;
  }

  async setex(key: string, seconds: number, value: string): Promise<"OK"> {
    this.values.set(key, { value, seconds });
    return "OK";
  }
}

describe("given the agent sandbox key share", () => {
  describe("when the process has Redis", () => {
    it("holds the sealed token as JSON under main's key for the reuse window", async () => {
      const redis = new RedisValues();
      const share = RedisAgentSandboxKeyShareRepository.create({
        redis,
        sealing,
        reuseMs: 60_000,
      });

      await share.hold({ projectId: "project_1", token: "sk-lw-shared" });

      expect(redis.values.get("ttlcache:agent-sandbox-key:project_1")).toEqual({
        value: JSON.stringify("sealed(sk-lw-shared)"),
        seconds: 60,
      });
    });

    it("reads a key another pod shared, as main wrote it", async () => {
      const redis = new RedisValues();
      await redis.setex(
        "ttlcache:agent-sandbox-key:project_1",
        60,
        JSON.stringify("sealed(sk-lw-from-main)"),
      );
      const share = RedisAgentSandboxKeyShareRepository.create({ redis, sealing });

      await expect(share.findSharedKey({ projectId: "project_1" })).resolves.toBe(
        "sk-lw-from-main",
      );
    });

    /** @scenario "A shared key the platform can no longer read is replaced" */
    it("reads nothing from an entry the cipher cannot open, so the run mints anew", async () => {
      const redis = new RedisValues();
      await redis.setex("ttlcache:agent-sandbox-key:project_1", 60, JSON.stringify("tampered"));
      const share = RedisAgentSandboxKeyShareRepository.create({ redis, sealing });

      await expect(share.findSharedKey({ projectId: "project_1" })).resolves.toBeUndefined();
    });
  });

  describe("when the process has no Redis", () => {
    it("shares the key within this process, as main's memory fallback did", async () => {
      const share = RedisAgentSandboxKeyShareRepository.create({ redis: null, sealing });

      await share.hold({ projectId: "project_1", token: "sk-lw-local" });

      await expect(share.findSharedKey({ projectId: "project_1" })).resolves.toBe("sk-lw-local");
      await expect(share.findSharedKey({ projectId: "project_2" })).resolves.toBeUndefined();
    });
  });
});
