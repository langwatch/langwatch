import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the boundaries the inline fallback reaches for (the repository and the
// storage accessor) so the "no sender registered" path can run the handler
// without a real DB or S3. The seam logic under test (dispatch vs inline) stays
// real. `vi.hoisted` lets the spies exist before the hoisted `vi.mock` factory.
const { findOne, streamStaged } = vi.hoisted(() => ({
  findOne: vi.fn(),
  streamStaged: vi.fn(),
}));
vi.mock("../dataset.repository", () => ({
  DatasetRepository: class {
    findOne = findOne;
  },
}));
vi.mock("../dataset-storage", () => ({
  getDatasetStorage: vi.fn().mockResolvedValue({ streamStaged }),
}));

import {
  enqueueDatasetNormalize,
  registerDatasetNormalizeEnqueue,
} from "../dataset-normalize.queue";

const payload = {
  id: "d1",
  tenantId: "p1",
  projectId: "p1",
  datasetId: "d1",
  stagingKey: "staging/p1/u1",
  filename: "data.jsonl",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // Reset the process-wide registered sender so tests don't leak into each
  // other (the seam is a module-global by design).
  registerDatasetNormalizeEnqueue(undefined as never);
});

describe("enqueueDatasetNormalize()", () => {
  describe("when a queue sender has been registered", () => {
    it("dispatches the payload onto the registered sender and does not inline-run", async () => {
      const sender = vi.fn().mockResolvedValue(undefined);
      registerDatasetNormalizeEnqueue(sender);

      await enqueueDatasetNormalize({ prisma: {} as never, payload });

      expect(sender).toHaveBeenCalledWith(payload);
      // The inline handler would have loaded the dataset row; it must not run.
      expect(findOne).not.toHaveBeenCalled();
    });
  });

  describe("when no queue sender is registered (dev/test, no worker)", () => {
    it("inline-runs the handler", async () => {
      // A non-processing dataset makes the handler no-op cleanly, proving it was
      // the inline path that executed (it loaded the row).
      findOne.mockResolvedValue({ id: "d1", status: "ready" });

      await enqueueDatasetNormalize({ prisma: {} as never, payload });

      expect(findOne).toHaveBeenCalledWith({ id: "d1", projectId: "p1" });
      expect(streamStaged).not.toHaveBeenCalled();
    });
  });

  describe("when two inline normalizes race for the same dataset", () => {
    /**
     * Concurrent-normalize guard (ADR-032): inline mode has no GroupQueue
     * concurrency=1, so two normalizes (e.g. manual retry + reaper re-drive)
     * could otherwise both read `processing` and race chunk writes / the
     * failure-path `deleteChunksFrom(0)` → data loss. The process-local
     * per-dataset mutex serializes them: the second handler must not START
     * until the first SETTLES.
     */
    it("does not start the second handler until the first has settled", async () => {
      // Park the first handler on findOne via a gate we resolve manually; the
      // second must stay blocked behind the mutex (findOne called only once).
      let resolveFirst!: (v: { id: string; status: string }) => void;
      const firstGate = new Promise<{ id: string; status: string }>((r) => {
        resolveFirst = r;
      });
      findOne
        .mockReturnValueOnce(firstGate)
        .mockResolvedValue({ id: "d1", status: "ready" });

      const first = enqueueDatasetNormalize({ prisma: {} as never, payload });
      const second = enqueueDatasetNormalize({ prisma: {} as never, payload });

      // Drain microtasks: the first handler reaches findOne and parks there.
      await new Promise((r) => setTimeout(r, 0));
      expect(findOne).toHaveBeenCalledTimes(1);

      // Release the first; only now may the second run.
      resolveFirst({ id: "d1", status: "ready" });
      await Promise.all([first, second]);
      expect(findOne).toHaveBeenCalledTimes(2);
    });

    it("isolates the mutex per dataset (a different dataset is not blocked)", async () => {
      let resolveFirst!: (v: { id: string; status: string }) => void;
      const firstGate = new Promise<{ id: string; status: string }>((r) => {
        resolveFirst = r;
      });
      // d1 parks; d2 (different key) should proceed independently.
      findOne
        .mockReturnValueOnce(firstGate)
        .mockResolvedValue({ id: "d2", status: "ready" });

      const first = enqueueDatasetNormalize({ prisma: {} as never, payload });
      const second = enqueueDatasetNormalize({
        prisma: {} as never,
        payload: { ...payload, id: "d2", datasetId: "d2" },
      });

      await new Promise((r) => setTimeout(r, 0));
      // d2 is a different mutex key → it ran without waiting for d1.
      expect(findOne).toHaveBeenCalledTimes(2);

      resolveFirst({ id: "d1", status: "ready" });
      await Promise.all([first, second]);
    });
  });
});
