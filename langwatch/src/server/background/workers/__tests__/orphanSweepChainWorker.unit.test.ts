import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
}));

vi.mock("~/server/db", () => ({ prisma: prismaMock }));

const sweepProjectMock = vi.hoisted(() => vi.fn());

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    dataRetention: {
      orphanSweep: { sweepProject: sweepProjectMock },
    },
  }),
}));

import { runOrphanSweepChainJob } from "../orphanSweepChainWorker";

const makeJob = (tenantId: string) =>
  ({ id: "job-1", data: { tenantId } }) as any;

describe("runOrphanSweepChainJob (chain step)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the project is active", () => {
    it("sweeps and returns stopChain=false so the worker re-enqueues the next link", async () => {
      prismaMock.project.findUnique.mockResolvedValue({
        id: "proj_1",
        archivedAt: null,
      });
      sweepProjectMock.mockResolvedValue(undefined);

      const outcome = await runOrphanSweepChainJob(makeJob("proj_1"));

      expect(sweepProjectMock).toHaveBeenCalledWith({ projectId: "proj_1" });
      expect(outcome).toEqual({ stopChain: false });
    });
  });

  describe("given the project has been archived since the last chain step", () => {
    it("does not sweep and returns stopChain=true so the chain ends", async () => {
      prismaMock.project.findUnique.mockResolvedValue({
        id: "proj_1",
        archivedAt: new Date("2026-05-30"),
      });

      const outcome = await runOrphanSweepChainJob(makeJob("proj_1"));

      expect(sweepProjectMock).not.toHaveBeenCalled();
      expect(outcome).toEqual({ stopChain: true });
    });
  });

  describe("given the project has been hard-deleted", () => {
    it("does not sweep and returns stopChain=true", async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);

      const outcome = await runOrphanSweepChainJob(makeJob("proj_1"));

      expect(sweepProjectMock).not.toHaveBeenCalled();
      expect(outcome).toEqual({ stopChain: true });
    });
  });

  describe("given the sweep throws a transient error", () => {
    /**
     * Regression: a flaky PG outage / row-locking error during sweep must
     * NOT silence the chain. The next link (24h later) gets another shot.
     * Without this, a single bad run could permanently strand a tenant's
     * dangling rows. The worker swallows the sweep error and still returns
     * stopChain=false.
     */
    it("returns stopChain=false so the chain continues despite the failure", async () => {
      prismaMock.project.findUnique.mockResolvedValue({
        id: "proj_1",
        archivedAt: null,
      });
      sweepProjectMock.mockRejectedValue(new Error("postgres timeout"));

      const outcome = await runOrphanSweepChainJob(makeJob("proj_1"));

      expect(sweepProjectMock).toHaveBeenCalledWith({ projectId: "proj_1" });
      expect(outcome).toEqual({ stopChain: false });
    });
  });
});
