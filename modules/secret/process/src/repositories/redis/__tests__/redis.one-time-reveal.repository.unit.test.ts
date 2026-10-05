/**
 * A parked reveal in Redis: the secret rests sealed with the process's cipher, in the
 * shape every earlier process wrote, so a dump of the store lists no plaintext.
 * Spec: modules/secret/specs/one-time-reveal.feature
 */
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { ReversibleTestSecretEncryption } from "../../../app/__tests__/secret.fixture.ts";
import { RedisOneTimeRevealRepository } from "../redis.one-time-reveal.repository.ts";

const cipher = new ReversibleTestSecretEncryption();
const reveal = { kind: "virtual_key" as const, keyId: "vk_1", preview: "sk-…4f2a", secret: "sk" };

function storeOfOneKey() {
  const values = new Map<string, string>();
  const redis = redisDouble({
    set: (key: unknown, value: unknown) => {
      values.set(String(key), String(value));
      return Promise.resolve("OK");
    },
    getdel: (key: unknown) => {
      const value = values.get(String(key)) ?? null;
      values.delete(String(key));
      return Promise.resolve(value);
    },
  });
  return { values, repository: RedisOneTimeRevealRepository.create({ redis, cipher }) };
}

describe("RedisOneTimeRevealRepository", () => {
  describe("when a reveal is parked", () => {
    it("stores the secret sealed and serves it opened", async () => {
      const { values, repository } = storeOfOneKey();

      await repository.put({ organizationId: "org_acme", revealId: "rvl_1", reveal, ttlMs: 1000 });

      expect(values.get("secret_reveal:org_acme:rvl_1")).toBe(
        JSON.stringify({
          kind: "virtual_key",
          keyId: "vk_1",
          preview: "sk-…4f2a",
          sealed: "encrypted(sk)",
        }),
      );
      await expect(
        repository.take({ organizationId: "org_acme", revealId: "rvl_1" }),
      ).resolves.toEqual({ taken: true, reveal });
    });
  });
});
