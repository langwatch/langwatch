import { describe, expect, it, vi } from "vitest";
import { resolveCoalesceMaxBatch } from "../queueManager";

describe("resolveCoalesceMaxBatch", () => {
  describe("given an entry with no coalescing bound", () => {
    it("answers one, leaving the job on the per-job path", () => {
      expect(resolveCoalesceMaxBatch({}, { id: "a" })).toBe(1);
    });
  });

  describe("given an entry with a constant bound", () => {
    it("answers the same number for every job", () => {
      const entry = { coalesceMaxBatch: 200 };

      expect(resolveCoalesceMaxBatch(entry, { id: "a" })).toBe(200);
      expect(resolveCoalesceMaxBatch(entry, { id: "b" })).toBe(200);
    });
  });

  describe("given an entry whose bound is resolved per payload", () => {
    it("answers what the resolver says about this job", () => {
      const entry = {
        coalesceMaxBatch: (payload: any) => (payload.oversized ? 1 : 64),
      };

      expect(resolveCoalesceMaxBatch(entry, { oversized: true })).toBe(1);
      expect(resolveCoalesceMaxBatch(entry, { oversized: false })).toBe(64);
    });

    it("hands the resolver the payload it was asked about", () => {
      const coalesceMaxBatch = vi.fn().mockReturnValue(64);
      const payload = { id: "a", oversized: false };

      resolveCoalesceMaxBatch({ coalesceMaxBatch }, payload);

      expect(coalesceMaxBatch).toHaveBeenCalledWith(payload);
    });
  });
});
