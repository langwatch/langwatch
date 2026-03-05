import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RedisSpanDedupeService,
  NullSpanDedupeService,
} from "../span-dedupe.service";

describe("RedisSpanDedupeService", () => {
  const tenantId = "project_123";
  const traceId = "abc123";
  const spanId = "span456";
  const expectedKey = `span_dedup:${tenantId}:${traceId}:${spanId}`;

  const mockSet = vi.fn();
  const mockExpire = vi.fn();
  const mockDel = vi.fn();

  const mockRedis = {
    set: (...args: unknown[]) => mockSet(...args),
    expire: (...args: unknown[]) => mockExpire(...args),
    del: (...args: unknown[]) => mockDel(...args),
  };

  let service: RedisSpanDedupeService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RedisSpanDedupeService(mockRedis as any);
  });

  describe("tryAcquireProcessingLock", () => {
    describe("when SET NX returns OK", () => {
      it("returns true and passes correct key and args", async () => {
        mockSet.mockResolvedValue("OK");

        const result = await service.tryAcquireProcessingLock(
          tenantId,
          traceId,
          spanId,
        );

        expect(result).toBe(true);
        expect(mockSet).toHaveBeenCalledWith(expectedKey, "1", "EX", 60, "NX");
      });
    });

    describe("when SET NX returns null (key exists)", () => {
      it("returns false", async () => {
        mockSet.mockResolvedValue(null);

        const result = await service.tryAcquireProcessingLock(
          tenantId,
          traceId,
          spanId,
        );

        expect(result).toBe(false);
      });
    });

    describe("when Redis throws an error", () => {
      it("returns null and does not throw", async () => {
        mockSet.mockRejectedValue(new Error("Redis connection lost"));

        const result = await service.tryAcquireProcessingLock(
          tenantId,
          traceId,
          spanId,
        );

        expect(result).toBeNull();
      });
    });
  });

  describe("tryConfirmProcessed", () => {
    it("calls EXPIRE with confirmed TTL", async () => {
      mockExpire.mockResolvedValue(1);

      await service.tryConfirmProcessed(tenantId, traceId, spanId);

      expect(mockExpire).toHaveBeenCalledWith(expectedKey, 3600);
    });

    describe("when Redis throws an error", () => {
      it("does not throw", async () => {
        mockExpire.mockRejectedValue(new Error("Redis connection lost"));

        await expect(
          service.tryConfirmProcessed(tenantId, traceId, spanId),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("tryReleaseOnFailure", () => {
    it("calls DEL on the key", async () => {
      mockDel.mockResolvedValue(1);

      await service.tryReleaseOnFailure(tenantId, traceId, spanId);

      expect(mockDel).toHaveBeenCalledWith(expectedKey);
    });

    describe("when Redis throws an error", () => {
      it("does not throw", async () => {
        mockDel.mockRejectedValue(new Error("Redis connection lost"));

        await expect(
          service.tryReleaseOnFailure(tenantId, traceId, spanId),
        ).resolves.toBeUndefined();
      });
    });
  });
});

describe("NullSpanDedupeService", () => {
  const service = new NullSpanDedupeService();

  it("tryAcquireProcessingLock returns null", async () => {
    const result = await service.tryAcquireProcessingLock("t", "tr", "sp");
    expect(result).toBeNull();
  });

  it("tryConfirmProcessed resolves", async () => {
    await expect(
      service.tryConfirmProcessed("t", "tr", "sp"),
    ).resolves.toBeUndefined();
  });

  it("tryReleaseOnFailure resolves", async () => {
    await expect(
      service.tryReleaseOnFailure("t", "tr", "sp"),
    ).resolves.toBeUndefined();
  });
});
