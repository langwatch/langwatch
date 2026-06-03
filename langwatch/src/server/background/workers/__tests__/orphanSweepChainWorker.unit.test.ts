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

const seedChainMock = vi.hoisted(() => vi.fn());

vi.mock("../../queues/orphanSweepChainQueue", () => ({
  ORPHAN_SWEEP_CHAIN_INTERVAL_MS: 24 * 60 * 60 * 1000,
  seedOrphanSweepChain: seedChainMock,
}));

import {
  handleChainStepCompleted,
  runOrphanSweepChainJob,
} from "../orphanSweepChainWorker";

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

describe("handleChainStepCompleted (self-perpetuating link)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the previous step's outcome was stopChain=false", () => {
    /**
     * The link the BullMQ Worker calls via `worker.on('completed')`. Must
     * run AFTER the previous job has transitioned out of `active` AND been
     * removed (`removeOnComplete: true`), otherwise the same jobId would
     * dedup the add into a no-op and the chain stalls after one step.
     * The 24h delay is the chain's canonical "1 per tenant per day"
     * cadence — bursty ingest is deduped against this delayed job.
     */
    it("re-enqueues the next step with a 24h delay", async () => {
      await handleChainStepCompleted(
        { data: { tenantId: "proj_1" } },
        { stopChain: false },
      );

      expect(seedChainMock).toHaveBeenCalledTimes(1);
      expect(seedChainMock).toHaveBeenCalledWith("proj_1", {
        delayMs: 24 * 60 * 60 * 1000,
      });
    });
  });

  describe("when the previous step's outcome was stopChain=true", () => {
    it("does not re-enqueue (project was archived or deleted)", async () => {
      await handleChainStepCompleted(
        { data: { tenantId: "proj_1" } },
        { stopChain: true },
      );

      expect(seedChainMock).not.toHaveBeenCalled();
    });
  });

  describe("when the outcome is undefined", () => {
    /** Defensive: a returnValue=undefined defaults to "continue the chain"
     *  rather than silently stopping. Matches the explicit
     *  `outcome?.stopChain` check in the worker. */
    it("treats it as continue-the-chain and re-enqueues", async () => {
      await handleChainStepCompleted(
        { data: { tenantId: "proj_1" } },
        undefined,
      );

      expect(seedChainMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the job has no tenantId", () => {
    it("is a no-op", async () => {
      await handleChainStepCompleted(undefined, { stopChain: false });
      await handleChainStepCompleted(
        { data: { tenantId: "" } } as any,
        { stopChain: false },
      );

      expect(seedChainMock).not.toHaveBeenCalled();
    });
  });

  describe("when seedOrphanSweepChain itself throws (e.g. Redis blip)", () => {
    /** The chain stalls until the next ingest re-seeds the tenant — that's
     *  the explicit cold-start tolerance. The completed handler must not
     *  throw out into the worker event loop, only log. */
    it("swallows the error so the BullMQ event loop is unaffected", async () => {
      seedChainMock.mockRejectedValueOnce(new Error("redis unavailable"));

      await expect(
        handleChainStepCompleted(
          { data: { tenantId: "proj_1" } },
          { stopChain: false },
        ),
      ).resolves.toBeUndefined();
    });
  });
});
