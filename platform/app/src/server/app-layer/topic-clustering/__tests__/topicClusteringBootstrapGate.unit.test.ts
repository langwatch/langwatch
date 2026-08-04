import { describe, expect, it, vi } from "vitest";

import {
  BOOTSTRAP_CLAIM_TTL_SECONDS,
  createRateLimitedBootstrap,
} from "../topicClusteringBootstrapGate";

/** Minimal SET NX EX stand-in with real claim semantics. */
function fakeRedis() {
  const keys = new Set<string>();
  const set = vi.fn(
    async (key: string, _v: string, _ex: string, _ttl: number, _nx: string) => {
      if (keys.has(key)) return null;
      keys.add(key);
      return "OK";
    },
  );
  return { redis: { set } as never, set, keys };
}

describe("given a rate-limited topic clustering bootstrap", () => {
  describe("when a project is seen for the first time in the window", () => {
    it("issues the bootstrap", async () => {
      const bootstrap = vi.fn().mockResolvedValue(undefined);
      const { redis } = fakeRedis();

      await createRateLimitedBootstrap({ redis, bootstrap })("project-1");

      expect(bootstrap).toHaveBeenCalledWith("project-1");
    });

    it("claims the key with a TTL, so the window expires on its own", async () => {
      const bootstrap = vi.fn().mockResolvedValue(undefined);
      const { redis, set } = fakeRedis();

      await createRateLimitedBootstrap({ redis, bootstrap })("project-1");

      expect(set).toHaveBeenCalledWith(
        "topic-clustering:bootstrap-claimed:project-1",
        "1",
        "EX",
        BOOTSTRAP_CLAIM_TTL_SECONDS,
        "NX",
      );
    });
  });

  describe("when the same project is seen again inside the window", () => {
    it("does not issue a second bootstrap", async () => {
      // This is what makes calling it on every ingest affordable.
      const bootstrap = vi.fn().mockResolvedValue(undefined);
      const { redis } = fakeRedis();
      const gated = createRateLimitedBootstrap({ redis, bootstrap });

      await gated("project-1");
      await gated("project-1");
      await gated("project-1");

      expect(bootstrap).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a different project is seen inside the window", () => {
    it("is claimed independently", async () => {
      const bootstrap = vi.fn().mockResolvedValue(undefined);
      const { redis } = fakeRedis();
      const gated = createRateLimitedBootstrap({ redis, bootstrap });

      await gated("project-1");
      await gated("project-2");

      expect(bootstrap.mock.calls.map(([id]) => id)).toEqual([
        "project-1",
        "project-2",
      ]);
    });
  });

  describe("when Redis is unavailable", () => {
    it("bootstraps anyway rather than risking an unscheduled project", async () => {
      // Fail-open on purpose: an extra commit is cheap, a project with no
      // clustering schedule is a silent product outage.
      const bootstrap = vi.fn().mockResolvedValue(undefined);
      const redis = {
        set: vi.fn().mockRejectedValue(new Error("connection refused")),
      } as never;

      await createRateLimitedBootstrap({ redis, bootstrap })("project-1");

      expect(bootstrap).toHaveBeenCalledWith("project-1");
    });
  });

  describe("when the bootstrap itself throws", () => {
    it("propagates, so the caller decides how to report it", async () => {
      const bootstrap = vi.fn().mockRejectedValue(new Error("store down"));
      const { redis } = fakeRedis();

      await expect(
        createRateLimitedBootstrap({ redis, bootstrap })("project-1"),
      ).rejects.toThrow("store down");
    });
  });
});
