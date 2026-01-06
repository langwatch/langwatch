import { describe, expect, it, vi } from "vitest";
import type { TraceGroups } from "../types";
import { checkThreshold, getLatestUpdatedAt } from "../utils";

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
