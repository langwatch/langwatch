import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceGroups } from "../types";
import {
  checkThreshold,
  getLatestUpdatedAt,
  triggerSentForMany,
} from "../utils";

const mockFindMany = vi.fn();

vi.mock("~/server/db", () => ({
  prisma: {
    triggerSent: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

describe("checkThreshold", () => {
  describe("when operator is 'gt'", () => {
    it("returns true when value is greater than threshold", () => {
      expect(checkThreshold(10, 5, "gt")).toBe(true);
    });

    it("returns false when value is less than threshold", () => {
      expect(checkThreshold(3, 5, "gt")).toBe(false);
    });

    it("returns false when value equals threshold", () => {
      expect(checkThreshold(5, 5, "gt")).toBe(false);
    });
  });

  describe("when operator is 'lt'", () => {
    it("returns true when value is less than threshold", () => {
      expect(checkThreshold(3, 5, "lt")).toBe(true);
    });

    it("returns false when value is greater than threshold", () => {
      expect(checkThreshold(10, 5, "lt")).toBe(false);
    });

    it("returns false when value equals threshold", () => {
      expect(checkThreshold(5, 5, "lt")).toBe(false);
    });
  });

  describe("when operator is 'gte'", () => {
    it("returns true when value is greater than threshold", () => {
      expect(checkThreshold(10, 5, "gte")).toBe(true);
    });

    it("returns true when value equals threshold", () => {
      expect(checkThreshold(5, 5, "gte")).toBe(true);
    });

    it("returns false when value is less than threshold", () => {
      expect(checkThreshold(3, 5, "gte")).toBe(false);
    });
  });

  describe("when operator is 'lte'", () => {
    it("returns true when value is less than threshold", () => {
      expect(checkThreshold(3, 5, "lte")).toBe(true);
    });

    it("returns true when value equals threshold", () => {
      expect(checkThreshold(5, 5, "lte")).toBe(true);
    });

    it("returns false when value is greater than threshold", () => {
      expect(checkThreshold(10, 5, "lte")).toBe(false);
    });
  });

  describe("when operator is 'eq'", () => {
    it("returns true when value equals threshold", () => {
      expect(checkThreshold(5, 5, "eq")).toBe(true);
    });

    it("returns true when value is within floating point tolerance", () => {
      expect(checkThreshold(5.00005, 5, "eq")).toBe(true);
    });

    it("returns false when value differs from threshold", () => {
      expect(checkThreshold(5.001, 5, "eq")).toBe(false);
    });
  });

  describe("when operator is unknown", () => {
    it("returns false", () => {
      expect(checkThreshold(10, 5, "unknown")).toBe(false);
    });
  });
});

describe("getLatestUpdatedAt", () => {
  describe("when traces have multiple groups", () => {
    it("returns the most recent timestamp", () => {
      const traces: TraceGroups = {
        groups: [
          [
            {
              trace_id: "1",
              timestamps: { updated_at: 1000 },
            } as any,
            {
              trace_id: "2",
              timestamps: { updated_at: 2000 },
            } as any,
          ],
          [
            {
              trace_id: "3",
              timestamps: { updated_at: 3000 },
            } as any,
          ],
        ],
      };

      expect(getLatestUpdatedAt(traces)).toBe(3000);
    });
  });

  describe("when traces have one group", () => {
    it("returns the latest timestamp from that group", () => {
      const traces: TraceGroups = {
        groups: [
          [
            {
              trace_id: "1",
              timestamps: { updated_at: 1000 },
            } as any,
            {
              trace_id: "2",
              timestamps: { updated_at: 5000 },
            } as any,
          ],
        ],
      };

      expect(getLatestUpdatedAt(traces)).toBe(5000);
    });
  });

  describe("when traces are in descending order", () => {
    it("returns the first (latest) timestamp", () => {
      const traces: TraceGroups = {
        groups: [
          [
            {
              trace_id: "1",
              timestamps: { updated_at: 5000 },
            } as any,
            {
              trace_id: "2",
              timestamps: { updated_at: 3000 },
            } as any,
            {
              trace_id: "3",
              timestamps: { updated_at: 1000 },
            } as any,
          ],
        ],
      };

      expect(getLatestUpdatedAt(traces)).toBe(5000);
    });
  });
});

describe("triggerSentForMany()", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  describe("when traceIds is empty", () => {
    it("returns empty array without querying", async () => {
      const result = await triggerSentForMany("trigger-1", [], "project-1");

      expect(result).toEqual([]);
      expect(mockFindMany).not.toHaveBeenCalled();
    });
  });

  describe("when traceIds fit in a single chunk", () => {
    it("makes one query with all traceIds", async () => {
      const traceIds = ["trace-1", "trace-2", "trace-3"];
      mockFindMany.mockResolvedValue([{ traceId: "trace-1" }]);

      const result = await triggerSentForMany(
        "trigger-1",
        traceIds,
        "project-1",
      );

      expect(mockFindMany).toHaveBeenCalledTimes(1);
      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          triggerId: "trigger-1",
          traceId: { in: traceIds },
          projectId: "project-1",
        },
      });
      expect(result).toEqual([{ traceId: "trace-1" }]);
    });
  });

  describe("when traceIds exceed chunk size", () => {
    it("splits into multiple queries and merges results", async () => {
      // Create 1200 trace IDs to force 3 chunks (500 + 500 + 200)
      const traceIds = Array.from({ length: 1200 }, (_, i) => `trace-${i}`);

      mockFindMany
        .mockResolvedValueOnce([{ traceId: "trace-0" }])
        .mockResolvedValueOnce([{ traceId: "trace-500" }])
        .mockResolvedValueOnce([{ traceId: "trace-1000" }]);

      const result = await triggerSentForMany(
        "trigger-1",
        traceIds,
        "project-1",
      );

      expect(mockFindMany).toHaveBeenCalledTimes(3);

      // First chunk: 0-499
      const firstCall = mockFindMany.mock.calls[0]![0];
      expect(firstCall.where.traceId.in).toHaveLength(500);
      expect(firstCall.where.traceId.in[0]).toBe("trace-0");

      // Second chunk: 500-999
      const secondCall = mockFindMany.mock.calls[1]![0];
      expect(secondCall.where.traceId.in).toHaveLength(500);
      expect(secondCall.where.traceId.in[0]).toBe("trace-500");

      // Third chunk: 1000-1199
      const thirdCall = mockFindMany.mock.calls[2]![0];
      expect(thirdCall.where.traceId.in).toHaveLength(200);
      expect(thirdCall.where.traceId.in[0]).toBe("trace-1000");

      // Results merged
      expect(result).toEqual([
        { traceId: "trace-0" },
        { traceId: "trace-500" },
        { traceId: "trace-1000" },
      ]);
    });
  });

  describe("when traceIds exactly equal chunk size", () => {
    it("makes exactly one query", async () => {
      const traceIds = Array.from({ length: 500 }, (_, i) => `trace-${i}`);
      mockFindMany.mockResolvedValue([]);

      await triggerSentForMany("trigger-1", traceIds, "project-1");

      expect(mockFindMany).toHaveBeenCalledTimes(1);
      expect(mockFindMany.mock.calls[0]![0].where.traceId.in).toHaveLength(
        500,
      );
    });
  });
});
