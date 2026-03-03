import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSet = vi.fn();
const mockExpire = vi.fn();
const mockDel = vi.fn();

vi.mock("~/server/redis", () => ({
  connection: {
    set: (...args: unknown[]) => mockSet(...args),
    expire: (...args: unknown[]) => mockExpire(...args),
    del: (...args: unknown[]) => mockDel(...args),
  },
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { spanDedup } from "../spanDedup";

describe("spanDedup", () => {
  const tenantId = "project_123";
  const traceId = "abc123";
  const spanId = "span456";
  const expectedKey = `span_dedup:${tenantId}:${traceId}:${spanId}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("acquireProcessingLock", () => {
    describe("when SET NX returns OK", () => {
      it("returns true and passes correct key and args", async () => {
        mockSet.mockResolvedValue("OK");

        const result = await spanDedup.acquireProcessingLock(
          tenantId,
          traceId,
          spanId,
        );

        expect(result).toBe(true);
        expect(mockSet).toHaveBeenCalledWith(
          expectedKey,
          "1",
          "EX",
          60,
          "NX",
        );
      });
    });

    describe("when SET NX returns null (key exists)", () => {
      it("returns false", async () => {
        mockSet.mockResolvedValue(null);

        const result = await spanDedup.acquireProcessingLock(
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

        const result = await spanDedup.acquireProcessingLock(
          tenantId,
          traceId,
          spanId,
        );

        expect(result).toBeNull();
      });
    });
  });

  describe("confirmProcessed", () => {
    it("calls EXPIRE with confirmed TTL", async () => {
      mockExpire.mockResolvedValue(1);

      await spanDedup.confirmProcessed(tenantId, traceId, spanId);

      expect(mockExpire).toHaveBeenCalledWith(expectedKey, 3600);
    });

    describe("when Redis throws an error", () => {
      it("does not throw", async () => {
        mockExpire.mockRejectedValue(new Error("Redis connection lost"));

        await expect(
          spanDedup.confirmProcessed(tenantId, traceId, spanId),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("releaseOnFailure", () => {
    it("calls DEL on the key", async () => {
      mockDel.mockResolvedValue(1);

      await spanDedup.releaseOnFailure(tenantId, traceId, spanId);

      expect(mockDel).toHaveBeenCalledWith(expectedKey);
    });

    describe("when Redis throws an error", () => {
      it("does not throw", async () => {
        mockDel.mockRejectedValue(new Error("Redis connection lost"));

        await expect(
          spanDedup.releaseOnFailure(tenantId, traceId, spanId),
        ).resolves.toBeUndefined();
      });
    });
  });
});

describe("spanDedup when connection is undefined", () => {
  it("acquireProcessingLock returns null", async () => {
    vi.doMock("~/server/redis", () => ({ connection: undefined }));

    const { spanDedup: dedupNoRedis } = await import("../spanDedup");

    const result = await dedupNoRedis.acquireProcessingLock(
      "t",
      "tr",
      "sp",
    );
    expect(result).toBeNull();
  });
});
