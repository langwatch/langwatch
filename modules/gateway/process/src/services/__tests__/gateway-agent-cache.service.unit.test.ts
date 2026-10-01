import { beforeEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

import { MemoryGatewayAgentCacheEntryRepository } from "../../repositories/redis/redis.gateway-agent-cache.repository.ts";
import { GatewayAgentCacheService } from "../gateway-agent-cache.service.ts";

const encryption = {
  encrypt: (value: string) => `sealed:${value}`,
  decrypt: (value: string) => value.replace(/^sealed:/, ""),
};

describe("given an encrypted agent cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when entries are written and claimed", () => {
    /** @scenario "A stored entry is read back by its name" */
    /** @scenario "A second write replaces the entry" */
    it("reads the last value written under a name", async () => {
      const service = GatewayAgentCacheService.create({
        store: MemoryGatewayAgentCacheEntryRepository.create(),
        encryption,
      });

      await service.put({ projectId: "project-1", name: "SESSION", value: "first" });
      await service.put({ projectId: "project-1", name: "SESSION", value: "second" });

      await expect(service.get({ projectId: "project-1", name: "SESSION" })).resolves.toEqual({
        name: "SESSION",
        value: "second",
      });
    });

    /** @scenario "A claim on a free name is taken" */
    /** @scenario "A claim on a held name leaves the held value alone" */
    /** @scenario "Only one of several claims sent at once takes the name" */
    it("lets exactly one concurrent claim take a name", async () => {
      const service = GatewayAgentCacheService.create({
        store: MemoryGatewayAgentCacheEntryRepository.create(),
        encryption,
      });

      const claims = await Promise.all(
        ["first", "second", "third"].map((value) =>
          service.claim({ projectId: "project-1", name: "LOCK", value }),
        ),
      );

      expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
      await expect(service.get({ projectId: "project-1", name: "LOCK" })).resolves.toEqual({
        name: "LOCK",
        value: "first",
      });
    });
  });

  describe("when an entry's lifetime passes", () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
    const shortLived = {
      projectId: "project-1",
      name: "SESSION",
      value: "state",
      ttlSeconds: 0.01,
    };

    /** @scenario An entry stops answering once its lifetime passes */
    it("stops answering the name with the cache miss code", async () => {
      const service = GatewayAgentCacheService.create({
        store: MemoryGatewayAgentCacheEntryRepository.create(),
        encryption,
      });
      await service.put(shortLived);
      await expect(service.get(shortLived)).resolves.toMatchObject({ value: "state" });

      await pause();

      await expect(service.get(shortLived)).rejects.toMatchObject({
        code: "cache_entry_not_found",
      });
    });

    /** @scenario A name is free again once its lifetime passes */
    it("lets the next claim take the name", async () => {
      const service = GatewayAgentCacheService.create({
        store: MemoryGatewayAgentCacheEntryRepository.create(),
        encryption,
      });
      await expect(service.claim(shortLived)).resolves.toMatchObject({ claimed: true });
      await expect(service.claim(shortLived)).resolves.toMatchObject({ claimed: false });

      await pause();

      await expect(service.claim(shortLived)).resolves.toMatchObject({ claimed: true });
    });
  });

  describe("when the store cannot answer a claim", () => {
    /** @scenario A claim the store cannot answer raises rather than naming a winner */
    it("raises and never reports the name as taken", async () => {
      const store = MemoryGatewayAgentCacheEntryRepository.create();
      const service = GatewayAgentCacheService.create({
        store: {
          find: (key) => store.find(key),
          set: (key, value, ttlMs) => store.set(key, value, ttlMs),
          delete: (key) => store.delete(key),
          claim: () => Promise.reject(new Error("redis unavailable")),
        },
        encryption,
      });

      await expect(
        service.claim({ projectId: "project-1", name: "LOCK", value: "first" }),
      ).rejects.toThrow("redis unavailable");
    });
  });

  describe("when an entry cannot be decrypted", () => {
    /** @scenario "An entry the platform can no longer read answers as a miss" */
    it("raises the cache miss code", async () => {
      const store = MemoryGatewayAgentCacheEntryRepository.create();
      await store.set("ttlcache:agent-cache:project-1:SESSION", "unreadable", 60_000);
      const service = GatewayAgentCacheService.create({
        store,
        encryption: {
          encrypt: vi.fn(),
          decrypt: () => {
            throw new Error("bad ciphertext");
          },
        },
      });

      await expect(service.get({ projectId: "project-1", name: "SESSION" })).rejects.toMatchObject({
        code: "cache_entry_not_found",
      });
    });

    /** @scenario "An entry the platform can no longer read answers as a miss" */
    it("keeps the stored value out of its warning", async () => {
      const store = MemoryGatewayAgentCacheEntryRepository.create();
      await store.set("ttlcache:agent-cache:project-1:SESSION", "a-secret-nobody-may-log", 60_000);
      const service = GatewayAgentCacheService.create({
        store,
        encryption: {
          encrypt: vi.fn(),
          decrypt: () => {
            throw new Error("bad ciphertext");
          },
        },
      });

      await expect(service.get({ projectId: "project-1", name: "SESSION" })).rejects.toMatchObject({
        code: "cache_entry_not_found",
      });

      const written = JSON.stringify(logger.warn.mock.calls);
      expect(written).toContain("SESSION");
      expect(written).not.toContain("a-secret-nobody-may-log");
    });
  });

  describe("when a project does not hold the name", () => {
    it("raises the cache miss code", async () => {
      const service = GatewayAgentCacheService.create({
        store: MemoryGatewayAgentCacheEntryRepository.create(),
        encryption,
      });

      await expect(service.get({ projectId: "project-1", name: "MISSING" })).rejects.toMatchObject({
        code: "cache_entry_not_found",
      });
    });
  });
});
