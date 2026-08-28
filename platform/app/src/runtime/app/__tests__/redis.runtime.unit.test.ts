import { beforeEach, describe, expect, it, vi } from "vitest";

const connectResolved = vi.fn();
const readinessPing = vi.fn();
const shutdownConnection = vi.fn();

vi.mock("@langwatch/redis-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/redis-client")>();

  class FakeRedisConnectionService {
    constructor(_input: unknown) {}

    connectResolved(input: unknown): unknown {
      return connectResolved(input);
    }
  }

  class FakeRedisReadinessService {
    constructor(_input: unknown) {}

    ping(input: unknown): Promise<void> {
      return readinessPing(input) as Promise<void>;
    }
  }

  class FakeRedisShutdownService {
    static create(): FakeRedisShutdownService {
      return new FakeRedisShutdownService();
    }

    shutdown(input: unknown): Promise<void> {
      return shutdownConnection(input) as Promise<void>;
    }
  }

  return {
    ...actual,
    RedisConnectionService: FakeRedisConnectionService,
    RedisReadinessService: FakeRedisReadinessService,
    RedisShutdownService: FakeRedisShutdownService,
  };
});

const { AppRedisRuntime } = await import("../redis.runtime");
const [{ AppShutdownResources }, { createTestApp }, { assertRedisReady }] = await Promise.all([
  import("~/server/app-layer/app"),
  import("~/server/app-layer/presets"),
  import("~/server/app-layer/redis-readiness"),
]);

const logger = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

describe("AppRedisRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readinessPing.mockResolvedValue(void 0);
    shutdownConnection.mockResolvedValue(void 0);
  });

  it("resolves and constructs the configured standalone App connection once", () => {
    const connection = { disconnect: vi.fn() };
    connectResolved.mockReturnValue(connection);

    const runtime = AppRedisRuntime.create({
      config: { dbIndex: "3", url: "redis://localhost:6379" },
      logger,
    });

    expect(runtime.connection).toBe(connection);
    expect(runtime.resolution).toMatchObject({
      configured: true,
      db: 3,
      mode: "standalone",
      url: "redis://localhost:6379",
    });
    expect(connectResolved).toHaveBeenCalledWith({ config: runtime.resolution });
  });

  it("retains the resolved cluster plan and its connection", () => {
    const connection = { disconnect: vi.fn() };
    connectResolved.mockReturnValue(connection);

    const runtime = AppRedisRuntime.create({
      config: { clusterEndpoints: "one:6379", dbIndex: "3" },
      logger,
    });

    expect(runtime.connection).toBe(connection);
    expect(runtime.resolution).toMatchObject({
      configured: true,
      db: 0,
      endpoints: [{ host: "one", port: 6379 }],
      mode: "cluster",
    });
    expect(runtime.resolution.warnings).toContain(
      "REDIS_DB_INDEX is set but REDIS_CLUSTER_ENDPOINTS is active — cluster mode only supports database 0, ignoring",
    );
    expect(connectResolved).toHaveBeenCalledWith({ config: runtime.resolution });
  });

  it("keeps an unconfigured App Redis connection absent", async () => {
    connectResolved.mockReturnValue(null);

    const runtime = AppRedisRuntime.create({
      config: {},
      logger,
    });

    expect(runtime.connection).toBeNull();
    expect(runtime.resolution).toEqual({
      configured: false,
      reason: "unconfigured",
      warnings: [],
    });
    await runtime.close();

    expect(shutdownConnection).not.toHaveBeenCalled();
  });

  it("preserves the explicit skip gate even when a URL is supplied", () => {
    connectResolved.mockReturnValue(null);

    const runtime = AppRedisRuntime.create({
      config: { skip: true, url: "redis://localhost:6379" },
      logger,
    });

    expect(runtime.connection).toBeNull();
    expect(runtime.resolution).toEqual({
      configured: false,
      reason: "disabled",
      warnings: [],
    });
    expect(connectResolved).toHaveBeenCalledWith({ config: runtime.resolution });
  });

  it("retains the same close promise for concurrent successful shutdown", async () => {
    const connection = { disconnect: vi.fn() };
    connectResolved.mockReturnValue(connection);

    const runtime = AppRedisRuntime.create({
      config: { url: "redis://localhost:6379" },
      logger,
    });

    const first = runtime.close();
    const second = runtime.close();

    expect(second).toBe(first);
    await first;
    expect(shutdownConnection).toHaveBeenCalledOnce();
    expect(shutdownConnection).toHaveBeenCalledWith(connection);
  });

  it("retains a failed close for concurrent callers", async () => {
    const error = new Error("disconnect failed");
    const connection = { disconnect: vi.fn() };
    connectResolved.mockReturnValue(connection);
    shutdownConnection.mockRejectedValue(error);

    const runtime = AppRedisRuntime.create({
      config: { url: "redis://localhost:6379" },
      logger,
    });
    const first = runtime.close();
    const second = runtime.close();

    expect(second).toBe(first);
    await expect(first).rejects.toBe(error);
    expect(shutdownConnection).toHaveBeenCalledOnce();
  });

  it("hands one configured connection through the App to the readiness adapter before ordered shutdown", async () => {
    const connection = { disconnect: vi.fn(), ping: vi.fn() };
    connectResolved.mockReturnValue(connection);
    const runtime = AppRedisRuntime.create({
      config: {
        url: "redis://localhost:6379",
        dbIndex: "3",
      },
      logger,
    });
    const shutdownOrder: string[] = [];
    const shutdownResources = new AppShutdownResources();
    shutdownResources.register("subscriber", "drain", async () => {
      shutdownOrder.push("subscriber");
    });
    shutdownResources.register("redis", "redis", async () => {
      shutdownOrder.push("redis");
      await runtime.close();
    });
    const app = createTestApp({
      redis: runtime.connection,
      _shutdownResources: shutdownResources,
    });

    await assertRedisReady({ app, timeoutMs: 2_000 });
    await app.close();

    expect(connectResolved).toHaveBeenCalledOnce();
    expect(connectResolved).toHaveBeenCalledWith({
      config: expect.objectContaining({
        configured: true,
        db: 3,
        mode: "standalone",
        url: "redis://localhost:6379",
      }),
    });
    expect(app.redis).toBe(connection);
    expect(readinessPing).toHaveBeenCalledWith({
      connection,
      target: "App.redis",
      timeoutMs: 2_000,
    });
    expect(shutdownOrder).toEqual(["subscriber", "redis"]);
    expect(shutdownConnection).toHaveBeenCalledOnce();
    expect(shutdownConnection).toHaveBeenCalledWith(connection);
  });
});
