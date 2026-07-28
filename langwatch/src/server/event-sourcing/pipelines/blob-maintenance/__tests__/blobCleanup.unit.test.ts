import { describe, expect, it, vi } from "vitest";

import type { BlobSweepReport } from "~/server/event-sourcing/queues/groupQueue/blobSweeper";
import { createBlobMaintenancePipeline } from "../pipeline";
import {
  BLOB_CLEANUP_PROCESS_NAME,
  blobCleanupWake,
  runBlobCleanup,
} from "../process-manager/blobCleanup.process";

const report = (overrides: Partial<BlobSweepReport["totals"]> = {}): BlobSweepReport => ({
  queues: [],
  totals: {
    scanned: 0,
    truncated: false,
    leased: 0,
    repaired: 0,
    reclaimed: 0,
    bookkeeping: 0,
    pending: 0,
    ...overrides,
  },
  dryRun: false,
  durationMs: 1,
});

const wakeContext = (at: number) => ({
  at,
  now: at,
  key: BLOB_CLEANUP_PROCESS_NAME,
  projectId: "__global__",
  intents: {
    sweep: (key: string, payload: unknown) => ({
      type: "sweep",
      key,
      payload,
    }),
  },
});

describe("blobCleanup process", () => {
  describe("given the schedule fires", () => {
    describe("when the wake handler runs", () => {
      it("emits one sweep intent keyed by the tick", () => {
        const evolution = blobCleanupWake(
          { lastSweepAt: null },
          wakeContext(1_700) as never,
        );

        expect(evolution.state.lastSweepAt).toBe(1_700);
        expect(evolution.intents).toHaveLength(1);
        expect(evolution.intents?.[0]).toMatchObject({
          type: "sweep",
          key: "sweep:1700",
        });
      });

      // The commit that persists this evolution is what fences racing workers,
      // so a handler that read a clock or did I/O would make two workers diverge.
      it("derives everything from the context clock, never its own", () => {
        const first = blobCleanupWake({ lastSweepAt: 1 }, wakeContext(500) as never);
        const second = blobCleanupWake({ lastSweepAt: 1 }, wakeContext(500) as never);

        expect(first).toEqual(second);
      });
    });
  });

  describe("given the sweep intent executes", () => {
    describe("when the sweep reclaims blobs", () => {
      it("sweeps and then prunes its own outbox rows", async () => {
        const sweep = vi.fn().mockResolvedValue(report({ reclaimed: 3, scanned: 9 }));
        const deleteDispatchedBefore = vi.fn().mockResolvedValue(0);

        await runBlobCleanup({
          sweep,
          deleteDispatchedBefore,
          now: () => 10_000_000,
        })();

        expect(sweep).toHaveBeenCalledOnce();
        expect(deleteDispatchedBefore).toHaveBeenCalledWith({
          processName: BLOB_CLEANUP_PROCESS_NAME,
          before: 10_000_000 - 7 * 24 * 60 * 60 * 1000,
        });
      });
    });

    describe("when outbox retention fails", () => {
      it("does not fail the sweep it already completed", async () => {
        const sweep = vi.fn().mockResolvedValue(report({ reclaimed: 1 }));

        await expect(
          runBlobCleanup({
            sweep,
            deleteDispatchedBefore: vi.fn().mockRejectedValue(new Error("db down")),
          })(),
        ).resolves.toBeUndefined();

        expect(sweep).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given the pipeline is built", () => {
    describe("when the process manager is registered", () => {
      it("mounts a scheduled blobCleanup process", () => {
        const pipeline = createBlobMaintenancePipeline({
          cleanup: {
            sweep: vi.fn().mockResolvedValue(report()),
            deleteDispatchedBefore: vi.fn().mockResolvedValue(0),
          },
        });

        const pm = pipeline.processManagers.get(BLOB_CLEANUP_PROCESS_NAME);
        expect(pm).toBeDefined();
        expect(pm?.config.schedule?.everyMs).toBeGreaterThan(0);
        // No event handlers: a scheduled-only process must not register a
        // subscriber, or an infrastructure sweep starts costing per-event work.
        expect(pm?.config.eventTypes).toHaveLength(0);
      });
    });
  });
});
