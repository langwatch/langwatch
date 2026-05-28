import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { TraceSpanBoundService } from "../../trace-span-bound.service";

let redis: Redis;

beforeAll(async () => {
  ({ redisConnection: redis } = await startTestContainers());
});

afterAll(async () => {
  await stopTestContainers();
});

beforeEach(async () => {
  await redis.flushall();
});

const TENANT = "proj_acme";
const TRACE = "0af7651916cd43dd8448eb211c80319c";

function makeService(overrides?: {
  maxSpansPerTrace?: number;
  ttlSeconds?: number;
  logger?: { warn: ReturnType<typeof vi.fn> };
}) {
  return new TraceSpanBoundService({
    redis,
    maxSpansPerTrace: overrides?.maxSpansPerTrace ?? 3,
    ttlSeconds: overrides?.ttlSeconds,
    // Minimal logger surface; only warn is exercised by the bound.
    logger: (overrides?.logger ?? { warn: vi.fn() }) as never,
  });
}

describe("TraceSpanBoundService", () => {
  describe("given a trace under its span ingestion bound", () => {
    /** @scenario Spans within the bound are ingested normally */
    it("admits spans while the trace is under the ceiling", async () => {
      const service = makeService({ maxSpansPerTrace: 3 });

      expect(await service.admit(TENANT, TRACE)).toBe(true);
      expect(await service.admit(TENANT, TRACE)).toBe(true);
      expect(await service.admit(TENANT, TRACE)).toBe(true);
    });
  });

  describe("given a trace that has reached its span ingestion bound", () => {
    /** @scenario Spans past the bound are dropped at ingestion */
    it("drops every span once the trace passes the ceiling", async () => {
      const service = makeService({ maxSpansPerTrace: 3 });

      await service.admit(TENANT, TRACE); // 1
      await service.admit(TENANT, TRACE); // 2
      await service.admit(TENANT, TRACE); // 3 (at ceiling)

      expect(await service.admit(TENANT, TRACE)).toBe(false); // 4
      expect(await service.admit(TENANT, TRACE)).toBe(false); // 5
    });

    /** @scenario Spans past the bound are dropped at ingestion */
    it("keeps counting past the ceiling so true magnitude stays visible", async () => {
      const service = makeService({ maxSpansPerTrace: 2 });

      for (let i = 0; i < 5; i++) await service.admit(TENANT, TRACE);

      const counter = Number(await redis.get(`trace_spans:${TENANT}:${TRACE}`));
      expect(counter).toBe(5);
    });
  });

  describe("given one trace over its bound and another under it", () => {
    /** @scenario Dropping one trace's overflow does not affect other traces */
    it("drops only the over-bound trace's spans", async () => {
      const service = makeService({ maxSpansPerTrace: 2 });
      const otherTrace = "11111111111111111111111111111111";

      await service.admit(TENANT, TRACE); // 1
      await service.admit(TENANT, TRACE); // 2 (at ceiling)
      expect(await service.admit(TENANT, TRACE)).toBe(false); // over

      expect(await service.admit(TENANT, otherTrace)).toBe(true);
      expect(await service.admit(TENANT, otherTrace)).toBe(true);
    });
  });

  describe("given a trace that crosses its bound", () => {
    /** @scenario Crossing the bound is logged once, not per dropped span */
    it("logs the breach once on first crossing, not per dropped span", async () => {
      const warn = vi.fn();
      const service = makeService({ maxSpansPerTrace: 2, logger: { warn } });

      await service.admit(TENANT, TRACE); // 1
      await service.admit(TENANT, TRACE); // 2 (at ceiling, not over)
      await service.admit(TENANT, TRACE); // 3 (first over -> log)
      await service.admit(TENANT, TRACE); // 4 (over -> no log)
      await service.admit(TENANT, TRACE); // 5 (over -> no log)

      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a trace that keeps accruing spans", () => {
    it("slides the counter TTL forward on each span so an active trace stays bounded", async () => {
      const service = makeService({ maxSpansPerTrace: 100, ttlSeconds: 50 });
      const key = `trace_spans:${TENANT}:${TRACE}`;

      await service.admit(TENANT, TRACE);
      const firstTtl = await redis.ttl(key);
      expect(firstTtl).toBeGreaterThan(0);
      expect(firstTtl).toBeLessThanOrEqual(50);

      await service.admit(TENANT, TRACE);
      const secondTtl = await redis.ttl(key);
      // Refreshed back near the full window rather than decaying.
      expect(secondTtl).toBeGreaterThan(45);
    });
  });

  describe("given the bound is disabled (kill switch)", () => {
    it("admits every span and creates no counter key when the ceiling is 0", async () => {
      const service = makeService({ maxSpansPerTrace: 0 });

      for (let i = 0; i < 10; i++) {
        expect(await service.admit(TENANT, TRACE)).toBe(true);
      }
      expect(await redis.get(`trace_spans:${TENANT}:${TRACE}`)).toBeNull();
    });
  });

  describe("given an operator configures a custom ceiling", () => {
    /** @scenario An operator can retune the bound */
    it("enforces the configured ceiling", async () => {
      const service = makeService({ maxSpansPerTrace: 1 });

      expect(await service.admit(TENANT, TRACE)).toBe(true);
      expect(await service.admit(TENANT, TRACE)).toBe(false);
    });
  });
});
