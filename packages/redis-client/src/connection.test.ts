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

// ioredis is mocked rather than injected through a factory seam on purpose:
// the module mock is what lets "importing the package opens no connection"
// observe the REAL constructors, which is the guarantee ADR-093 makes.
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

const { RedisConnectionService } = await import("./connection");

function createLoggerSpy() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("RedisConnectionService", () => {
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

  describe("given a service constructed without a logger", () => {
    /** @scenario "A connection exists only when something asks for one" */
    it("constructs no client until connect is called", () => {
      const connections = new RedisConnectionService();

      expect(standaloneCalls).toHaveLength(0);

      const connection = connections.connect({ url: "redis://localhost:6379" });

      expect(connection).not.toBeNull();
      expect(standaloneCalls).toHaveLength(1);
      expect(clusterCalls).toHaveLength(0);
    });
  });

  describe("when connecting to a standalone URL", () => {
    it("passes the URL, database index and TLS setting through", () => {
      new RedisConnectionService().connect({
        url: "rediss://host:6379",
        dbIndex: "4",
      });

      expect(standaloneCalls[0]?.[0]).toBe("rediss://host:6379");
      expect(standaloneCalls[0]?.[1]).toMatchObject({ db: 4, tls: {} });
    });

    it("lifts the per-request retry budget for blocking commands", () => {
      new RedisConnectionService().connect({ url: "redis://localhost:6379" });

      expect(standaloneCalls[0]?.[1]).toMatchObject({
        maxRetriesPerRequest: null,
      });
    });

    it("passes no offline-queue option, leaving ioredis's default in place", () => {
      new RedisConnectionService().connect({ url: "redis://localhost:6379" });

      // Guards the finding this replaced: `offlineQueue` is not a constructor
      // option ioredis reads, so passing it advertised a fail-fast the client
      // never performed. Disabling buffering means `enableOfflineQueue: false`,
      // and that is a behaviour change with its own callers to fix first.
      expect(standaloneCalls[0]?.[1]).not.toHaveProperty("offlineQueue");
      expect(standaloneCalls[0]?.[1]).not.toHaveProperty("enableOfflineQueue");
    });
  });

  describe("when connecting to cluster endpoints", () => {
    it("constructs a cluster client over the parsed endpoints", () => {
      new RedisConnectionService().connect({
        clusterEndpoints: "one:6379,two:6380",
      });

      expect(standaloneCalls).toHaveLength(0);
      expect(clusterCalls).toHaveLength(1);
      expect(clusterCalls[0]?.[0]).toEqual([
        { host: "one", port: 6379 },
        { host: "two", port: 6380 },
      ]);
    });

    it("reads from all nodes", () => {
      new RedisConnectionService().connect({ clusterEndpoints: "one:6379" });

      expect(clusterCalls[0]?.[1]).toMatchObject({ scaleReads: "all" });
    });
  });

  describe("when the environment configures no Redis", () => {
    it("returns null without constructing a client", () => {
      const connections = new RedisConnectionService();

      expect(connections.connect({})).toBeNull();
      expect(connections.connect({ url: "redis://x", skip: true })).toBeNull();
      expect(standaloneCalls).toHaveLength(0);
      expect(clusterCalls).toHaveLength(0);
    });
  });

  describe("when a standalone client is asked for specifically", () => {
    it("returns a client typed as standalone", () => {
      const connection = new RedisConnectionService().connectStandalone({
        url: "redis://localhost:6379",
        dbIndex: "2",
      });

      expect(connection).not.toBeNull();
      expect(standaloneCalls).toHaveLength(1);
      expect(standaloneCalls[0]?.[1]).toMatchObject({ db: 2 });
      expect(clusterCalls).toHaveLength(0);
    });

    it("returns null without a URL, constructing nothing", () => {
      expect(
        new RedisConnectionService().connectStandalone({ url: void 0 }),
      ).toBeNull();
      expect(standaloneCalls).toHaveLength(0);
    });
  });

  describe("when a logger is supplied to the service", () => {
    it("reports configuration warnings", () => {
      const logger = createLoggerSpy();

      new RedisConnectionService({ logger }).connect({
        clusterEndpoints: "one:6379",
        dbIndex: "3",
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[1]).toContain(
        "only supports database 0",
      );
    });

    it("reports connection lifecycle events", () => {
      const logger = createLoggerSpy();

      const connection = new RedisConnectionService({ logger }).connect({
        url: "redis://localhost:6379",
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

      new RedisConnectionService({ logger }).connectResolved({
        config: {
          configured: false,
          reason: "unconfigured",
          warnings: ["heads up"],
        },
      });

      expect(logger.warn).toHaveBeenCalledWith({}, "heads up");
    });
  });

  describe("when a resolved configuration is supplied directly", () => {
    it("connects without re-resolving it", async () => {
      const { RedisConfigService } = await import("./config");
      const config = new RedisConfigService().resolve({
        url: "redis://localhost:6379",
      });

      expect(
        new RedisConnectionService().connectResolved({ config }),
      ).not.toBeNull();
      expect(standaloneCalls).toHaveLength(1);
    });
  });
});
