import { beforeEach, describe, expect, it, vi } from "vitest";

const standaloneCalls: Array<[string, Record<string, unknown>]> = [];
const clusterCalls: Array<[unknown, Record<string, unknown>]> = [];

class FakeConnection {
  readonly handlers = new Map<string, (...args: unknown[]) => void>();
  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, handler);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.(...args);
  }
}

vi.mock("ioredis", () => {
  class FakeIORedis extends FakeConnection {
    constructor(url: string, options: Record<string, unknown>) {
      super();
      standaloneCalls.push([url, options]);
    }
  }
  class FakeCluster extends FakeConnection {
    constructor(endpoints: unknown, options: Record<string, unknown>) {
      super();
      clusterCalls.push([endpoints, options]);
    }
  }
  return { default: FakeIORedis, Cluster: FakeCluster };
});

const { connectRedis, createRedisConnection } = await import("./connection");
const { resolveRedisConfig } = await import("./config");

function createLoggerSpy() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("createRedisConnection", () => {
  beforeEach(() => {
    standaloneCalls.length = 0;
    clusterCalls.length = 0;
  });

  describe("given the module has only been imported", () => {
    /** @scenario "Importing the package opens no connection" */
    it("has constructed no client", () => {
      expect(standaloneCalls).toHaveLength(0);
      expect(clusterCalls).toHaveLength(0);
    });
  });

  describe("when called with a standalone URL", () => {
    /** @scenario "A connection exists only when something asks for one" */
    it("constructs exactly one client", () => {
      const connection = createRedisConnection({
        env: { url: "redis://localhost:6379" },
      });

      expect(connection).not.toBeNull();
      expect(standaloneCalls).toHaveLength(1);
      expect(clusterCalls).toHaveLength(0);
    });

    it("passes the URL, database index and TLS setting through", () => {
      createRedisConnection({
        env: { url: "rediss://host:6379", dbIndex: "4" },
      });

      expect(standaloneCalls[0]?.[0]).toBe("rediss://host:6379");
      expect(standaloneCalls[0]?.[1]).toMatchObject({ db: 4, tls: {} });
    });

    it("disables the offline queue and the per-request retry budget", () => {
      createRedisConnection({ env: { url: "redis://localhost:6379" } });

      expect(standaloneCalls[0]?.[1]).toMatchObject({
        maxRetriesPerRequest: null,
        offlineQueue: false,
      });
    });
  });

  describe("when called with cluster endpoints", () => {
    it("constructs a cluster client over the parsed endpoints", () => {
      createRedisConnection({ env: { clusterEndpoints: "one:6379,two:6380" } });

      expect(standaloneCalls).toHaveLength(0);
      expect(clusterCalls).toHaveLength(1);
      expect(clusterCalls[0]?.[0]).toEqual([
        { host: "one", port: 6379 },
        { host: "two", port: 6380 },
      ]);
    });

    it("reads from all nodes", () => {
      createRedisConnection({ env: { clusterEndpoints: "one:6379" } });

      expect(clusterCalls[0]?.[1]).toMatchObject({ scaleReads: "all" });
    });
  });

  describe("when the environment configures no Redis", () => {
    it("returns null without constructing a client", () => {
      expect(createRedisConnection({ env: {} })).toBeNull();
      expect(createRedisConnection({ env: { url: "redis://x", skip: true } })).toBeNull();
      expect(standaloneCalls).toHaveLength(0);
      expect(clusterCalls).toHaveLength(0);
    });
  });

  describe("when a logger is supplied", () => {
    it("reports configuration warnings", () => {
      const logger = createLoggerSpy();

      createRedisConnection({
        env: { clusterEndpoints: "one:6379", dbIndex: "3" },
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[1]).toContain("only supports database 0");
    });

    it("reports connection lifecycle events", () => {
      const logger = createLoggerSpy();

      const connection = createRedisConnection({
        env: { url: "redis://localhost:6379" },
        logger,
      }) as unknown as FakeConnection;

      connection.emit("ready");
      expect(logger.info).toHaveBeenCalledWith(
        { mode: "standalone", db: 0 },
        "ready to accept commands",
      );

      const error = new Error("boom");
      connection.emit("error", error);
      expect(logger.error).toHaveBeenCalledWith(
        { mode: "standalone", db: 0, error },
        "error",
      );
    });

    it("warns even when no connection is created", () => {
      const logger = createLoggerSpy();

      connectRedis(
        { configured: false, reason: "unconfigured", warnings: ["heads up"] },
        logger,
      );

      expect(logger.warn).toHaveBeenCalledWith({}, "heads up");
    });
  });

  describe("when a resolved configuration is supplied directly", () => {
    it("connects without re-resolving it", () => {
      const config = resolveRedisConfig({ url: "redis://localhost:6379" });

      expect(connectRedis(config)).not.toBeNull();
      expect(standaloneCalls).toHaveLength(1);
    });
  });
});
