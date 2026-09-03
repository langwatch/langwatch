import { describe, expect, it, vi } from "vitest";
import {
  BOOTSTRAP_CLAIM_TTL_SECONDS,
  RedisTopicClusteringBootstrapAdapter,
} from "../redis.topic-clustering-bootstrap.adapter";

/** Minimal SET NX EX stand-in with real claim semantics. */
function fakeRedis() {
  const keys = new Set<string>();
  const set = vi.fn(async (key: string, _v: string, _ex: string, _ttl: number, _nx: string) => {
    if (keys.has(key)) return null;
    keys.add(key);
    return "OK";
  });
  return { redis: { set } as never, set, keys };
}

function commands() {
  return {
    recordTopics: vi.fn(),
    requestClustering: vi.fn().mockResolvedValue(undefined),
  };
}

describe("given a rate-limited topic clustering bootstrap", () => {
  describe("when a project is seen for the first time in the window", () => {
    it("issues the bootstrap", async () => {
      const topicCommands = commands();
      const { redis } = fakeRedis();

      await RedisTopicClusteringBootstrapAdapter.create({
        redis,
        commands: topicCommands,
      }).claimAndBootstrap("project-1");

      expect(topicCommands.requestClustering).toHaveBeenCalledWith({
        tenantId: "project-1",
        occurredAt: expect.any(Number),
        trigger: "bootstrap",
      });
    });

    it("claims the key with a TTL, so the window expires on its own", async () => {
      const topicCommands = commands();
      const { redis, set } = fakeRedis();

      await RedisTopicClusteringBootstrapAdapter.create({
        redis,
        commands: topicCommands,
      }).claimAndBootstrap("project-1");

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
      const topicCommands = commands();
      const { redis } = fakeRedis();
      const gate = RedisTopicClusteringBootstrapAdapter.create({ redis, commands: topicCommands });

      await gate.claimAndBootstrap("project-1");
      await gate.claimAndBootstrap("project-1");
      await gate.claimAndBootstrap("project-1");

      expect(topicCommands.requestClustering).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a different project is seen inside the window", () => {
    it("is claimed independently", async () => {
      const topicCommands = commands();
      const { redis } = fakeRedis();
      const gate = RedisTopicClusteringBootstrapAdapter.create({ redis, commands: topicCommands });

      await gate.claimAndBootstrap("project-1");
      await gate.claimAndBootstrap("project-2");

      expect(topicCommands.requestClustering.mock.calls.map(([input]) => input.tenantId)).toEqual([
        "project-1",
        "project-2",
      ]);
    });
  });

  describe("when Redis is unavailable", () => {
    it("bootstraps anyway rather than risking an unscheduled project", async () => {
      // Fail-open on purpose: an extra commit is cheap, a project with no
      // clustering schedule is a silent product outage.
      const topicCommands = commands();
      const redis = {
        set: vi.fn().mockRejectedValue(new Error("connection refused")),
      } as never;

      await RedisTopicClusteringBootstrapAdapter.create({
        redis,
        commands: topicCommands,
      }).claimAndBootstrap("project-1");

      expect(topicCommands.requestClustering).toHaveBeenCalledWith({
        tenantId: "project-1",
        occurredAt: expect.any(Number),
        trigger: "bootstrap",
      });
    });
  });

  describe("when the bootstrap itself throws", () => {
    it("propagates, so the caller decides how to report it", async () => {
      const topicCommands = commands();
      topicCommands.requestClustering.mockRejectedValueOnce(new Error("store down"));
      const { redis } = fakeRedis();

      await expect(
        RedisTopicClusteringBootstrapAdapter.create({
          redis,
          commands: topicCommands,
        }).claimAndBootstrap("project-1"),
      ).rejects.toThrow("store down");
    });
  });
});
