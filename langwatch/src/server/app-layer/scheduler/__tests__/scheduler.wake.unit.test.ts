import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "~/utils/logger/server";
import { SchedulerRegistry } from "../scheduler.registry";
import { SchedulerService } from "../scheduler.service";
import type { ScheduledJobRepository } from "../scheduler.types";

const logger = createLogger("test:scheduler-wake");

/**
 * The best-effort Redis cross-pod wake (ADR-042 user decision): Postgres is the
 * sole correctness layer, so these tests only assert the pub/sub WIRING —
 * producers publish, a running loop subscribes and re-scans on a signal, and
 * teardown disconnects. The exactly-once guarantee is proven separately against
 * real Postgres in the integration suite.
 */
function makeRepo(): ScheduledJobRepository {
  return {
    findDue: vi.fn(async () => []),
    earliestActiveNextRunAt: vi.fn(async () => null),
    claim: vi.fn(async () => true),
    settleClaim: vi.fn(async () => true),
    upsertForTarget: vi.fn(async () => undefined),
    deactivateForTarget: vi.fn(async () => undefined),
    findAllForProject: vi.fn(async () => []),
    listForOps: vi.fn(async () => []),
  };
}

/** A fake ioredis whose `duplicate()` returns a capturable subscriber. */
function makeFakeRedis() {
  let messageHandler: ((channel: string) => void) | undefined;
  const subscriber = {
    on: vi.fn((event: string, handler: (channel: string) => void) => {
      if (event === "message") messageHandler = handler;
    }),
    subscribe: vi.fn(async () => 1),
    disconnect: vi.fn(),
  };
  const redis = {
    duplicate: vi.fn(() => subscriber),
    publish: vi.fn(async () => 1),
  };
  return {
    redis: redis as unknown as Redis,
    subscriber,
    publish: redis.publish,
    duplicate: redis.duplicate,
    emitMessage: (channel: string) => messageHandler?.(channel),
  };
}

describe("SchedulerService cross-pod wake (best-effort Redis)", () => {
  describe("publishWake", () => {
    it("publishes a signal on the wake channel", () => {
      const { redis, publish } = makeFakeRedis();
      SchedulerService.publishWake(redis);
      expect(publish).toHaveBeenCalledWith("scheduler:wake", "1");
    });

    it("is a safe no-op without a redis client", () => {
      expect(() => SchedulerService.publishWake(null)).not.toThrow();
      expect(() => SchedulerService.publishWake(undefined)).not.toThrow();
    });
  });

  describe("given a running worker loop with a redis client", () => {
    it("subscribes to the wake channel on start and disconnects on stop", async () => {
      const fake = makeFakeRedis();
      const svc = new SchedulerService({
        repo: makeRepo(),
        registry: new SchedulerRegistry(),
        processRole: "worker",
        logger,
        maxSleepMs: 10_000,
        redis: fake.redis,
      });

      svc.start();
      expect(fake.duplicate).toHaveBeenCalledTimes(1);
      expect(fake.subscriber.subscribe).toHaveBeenCalledWith("scheduler:wake");

      await svc.stop();
      expect(fake.subscriber.disconnect).toHaveBeenCalledTimes(1);
    });

    it("re-scans immediately when a wake signal arrives (does not wait out maxSleep)", async () => {
      const fake = makeFakeRedis();
      const repo = makeRepo();
      const svc = new SchedulerService({
        repo,
        registry: new SchedulerRegistry(),
        processRole: "worker",
        logger,
        maxSleepMs: 10_000, // long: a non-woken loop would sit here
        redis: fake.redis,
      });

      svc.start();
      try {
        // Let the loop settle into its long sleep after the first scan.
        await new Promise((r) => setTimeout(r, 30));
        const scansBefore = (repo.findDue as ReturnType<typeof vi.fn>).mock.calls
          .length;

        // A published wake arrives on the subscriber → loop re-scans now.
        fake.emitMessage("scheduler:wake");
        await new Promise((r) => setTimeout(r, 30));

        const scansAfter = (repo.findDue as ReturnType<typeof vi.fn>).mock.calls
          .length;
        expect(scansAfter).toBeGreaterThan(scansBefore);
      } finally {
        await svc.stop();
      }
    });
  });

  describe("given no redis client (Postgres-only)", () => {
    it("starts and stops cleanly without any subscriber", async () => {
      const svc = new SchedulerService({
        repo: makeRepo(),
        registry: new SchedulerRegistry(),
        processRole: "worker",
        logger,
        maxSleepMs: 10_000,
      });
      svc.start();
      await expect(svc.stop()).resolves.toBeUndefined();
    });
  });
});
