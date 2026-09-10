import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BroadcasterNotActiveError } from "@langwatch/presence-contract";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createMockRedis() {
  const subscriberOn = vi.fn();
  const subscriber = {
    subscribe: vi.fn((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null, count: number) => void;
      callback(null, 1);
    }),
    on: subscriberOn,
    quit: vi.fn().mockResolvedValue("OK"),
  };

  const redis = {
    duplicate: vi.fn().mockReturnValue(subscriber),
    publish: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
  };

  return { redis, subscriber, subscriberOn };
}

/** Starts service.close() and advances fake timers so the drain delay resolves. */
async function closeWithDrain(service: { close(): Promise<void> }) {
  const closing = service.close();
  await vi.advanceTimersByTimeAsync(2000);
  await closing;
}

describe("BroadcastAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not subscribe or schedule work until start", async () => {
    const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
    const { redis, subscriber } = createMockRedis();
    const service = BroadcastAdapter.create(redis as any);

    expect(redis.duplicate).not.toHaveBeenCalled();
    await service.start();
    expect(redis.duplicate).toHaveBeenCalledOnce();
    expect(subscriber.subscribe).toHaveBeenCalledOnce();

    await closeWithDrain(service);
    await service.close();
    expect(subscriber.quit).toHaveBeenCalledOnce();
  });

  it("does not become active when Redis subscription fails", async () => {
    const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
    const subscriber = {
      subscribe: vi.fn((...args: unknown[]) => {
        const callback = args.at(-1) as (error: Error, count: number) => void;
        callback(new Error("subscription unavailable"), 0);
      }),
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue("OK"),
    };
    const redis = { duplicate: vi.fn().mockReturnValue(subscriber) };
    const service = BroadcastAdapter.create(redis as any);

    await expect(service.start()).rejects.toThrow("subscription unavailable");
    await expect(service.broadcastToTenant("tenant-1", "event")).rejects.toBeInstanceOf(
      BroadcasterNotActiveError,
    );
    expect(subscriber.quit).toHaveBeenCalledOnce();
  });

  it("fans incoming Redis messages only to the matching tenant", async () => {
    const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
    const { redis, subscriberOn } = createMockRedis();
    const service = BroadcastAdapter.create(redis as any);
    const matching = service.getTenantEmitter("tenant-1");
    const other = service.getTenantEmitter("tenant-2");
    const matchingEvents: unknown[] = [];
    const otherEvents: unknown[] = [];
    matching.on("presence_updated", (event) => matchingEvents.push(event));
    other.on("presence_updated", (event) => otherEvents.push(event));

    await service.start();
    const messageListener = subscriberOn.mock.calls.find(([event]) => event === "message")?.[1];
    if (typeof messageListener !== "function")
      throw new Error("message listener was not registered");
    messageListener(
      "broadcast:presence_updated",
      JSON.stringify({ tenantId: "tenant-1", event: "joined" }),
    );

    expect(matchingEvents).toEqual([{ event: "joined", timestamp: expect.any(Number) }]);
    expect(otherEvents).toHaveLength(0);
    await closeWithDrain(service);
  });

  describe("broadcastToTenant()", () => {
    describe("when Redis is available", () => {
      it("publishes to Redis channel", async () => {
        const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
        const { redis } = createMockRedis();
        const service = BroadcastAdapter.create(redis as any);
        await service.start();

        await service.broadcastToTenant("tenant-1", "test-event", "trace_updated");

        expect(redis.publish).toHaveBeenCalledWith(
          "broadcast:trace_updated",
          expect.stringContaining("tenant-1"),
        );

        await closeWithDrain(service);
      });

      it("falls back to local emit when Redis publish fails", async () => {
        const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
        const { redis } = createMockRedis();
        redis.publish.mockRejectedValue(new Error("Redis down"));
        const service = BroadcastAdapter.create(redis as any);
        await service.start();

        const emitter = service.getTenantEmitter("tenant-1");
        const received: unknown[] = [];
        emitter.on("trace_updated", (data) => received.push(data));

        await service.broadcastToTenant("tenant-1", "test-event", "trace_updated");

        expect(received).toHaveLength(1);

        await closeWithDrain(service);
      });
    });

    describe("when no Redis is provided", () => {
      it("emits locally", async () => {
        const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
        const service = BroadcastAdapter.create(null);
        await service.start();

        const emitter = service.getTenantEmitter("tenant-1");
        const received: unknown[] = [];
        emitter.on("trace_updated", (data) => received.push(data));

        await service.broadcastToTenant("tenant-1", "test-event", "trace_updated");

        expect(received).toHaveLength(1);

        await closeWithDrain(service);
      });
    });

    describe("when service is closed", () => {
      it("throws BroadcasterNotActiveError", async () => {
        const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
        const service = BroadcastAdapter.create(null);
        await service.start();

        await closeWithDrain(service);

        await expect(
          service.broadcastToTenant("tenant-1", "test-event", "trace_updated"),
        ).rejects.toThrow(BroadcasterNotActiveError);
      });
    });
  });

  describe("getTenantEmitter()", () => {
    describe("when called for a new tenant", () => {
      it("creates a new emitter", async () => {
        const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
        const service = BroadcastAdapter.create(null);
        await service.start();

        const emitter = service.getTenantEmitter("tenant-1");

        expect(emitter).toBeDefined();
        expect(service.getActiveTenants()).toContain("tenant-1");

        await closeWithDrain(service);
      });
    });

    describe("when called for an existing tenant", () => {
      it("returns the cached emitter", async () => {
        const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
        const service = BroadcastAdapter.create(null);
        await service.start();

        const first = service.getTenantEmitter("tenant-1");
        const second = service.getTenantEmitter("tenant-1");

        expect(first).toBe(second);

        await closeWithDrain(service);
      });
    });

    describe("when creating a new emitter", () => {
      it("sets maxListeners to 50", async () => {
        const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
        const service = BroadcastAdapter.create(null);
        await service.start();

        const emitter = service.getTenantEmitter("tenant-1");

        expect(emitter.getMaxListeners()).toBe(50);

        await closeWithDrain(service);
      });
    });
  });

  describe("stale emitter cleanup", () => {
    describe("when an emitter has no listeners for 5+ minutes", () => {
      it("removes the emitter", async () => {
        const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
        const service = BroadcastAdapter.create(null);
        await service.start();

        // Create an emitter but don't add listeners
        service.getTenantEmitter("tenant-1");
        expect(service.getActiveTenants()).toContain("tenant-1");

        // Advance past the first cleanup tick (60s) to mark it as empty
        await vi.advanceTimersByTimeAsync(60 * 1000);

        // Advance past the 5-minute timeout plus another cleanup tick
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 60 * 1000);

        expect(service.getActiveTenants()).not.toContain("tenant-1");

        await closeWithDrain(service);
      });
    });

    describe("when an emitter has active listeners", () => {
      it("keeps the emitter", async () => {
        const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
        const service = BroadcastAdapter.create(null);
        await service.start();

        const emitter = service.getTenantEmitter("tenant-1");
        emitter.on("trace_updated", () => {});

        // Advance well past cleanup timeout
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

        expect(service.getActiveTenants()).toContain("tenant-1");

        await closeWithDrain(service);
      });
    });
  });

  describe("close()", () => {
    describe("when closing the service", () => {
      it("sets active to false so subsequent broadcasts throw", async () => {
        const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
        const service = BroadcastAdapter.create(null);
        await service.start();

        await closeWithDrain(service);

        await expect(service.broadcastToTenant("tenant-1", "test-event")).rejects.toThrow(
          BroadcasterNotActiveError,
        );
      });

      it("clears the cleanup interval", async () => {
        const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
        const service = BroadcastAdapter.create(null);
        await service.start();
        const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

        await closeWithDrain(service);

        expect(clearIntervalSpy).toHaveBeenCalled();
        clearIntervalSpy.mockRestore();
      });

      it("quits Redis after the drain delay", async () => {
        const { BroadcastAdapter } = await import("../../repositories/redis/redis.broadcast.repository.ts");
        const { redis, subscriber } = createMockRedis();
        const service = BroadcastAdapter.create(redis as any);
        await service.start();

        const closePromise = service.close();

        // Before drain delay, quit has not been called yet
        expect(subscriber.quit).not.toHaveBeenCalled();

        // Advance past the 2000ms drain delay
        await vi.advanceTimersByTimeAsync(2000);
        await closePromise;

        expect(subscriber.quit).toHaveBeenCalledOnce();
      });
    });
  });
});
