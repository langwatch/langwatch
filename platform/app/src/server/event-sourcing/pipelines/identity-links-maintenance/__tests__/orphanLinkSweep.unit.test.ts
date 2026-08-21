// @vitest-environment node
// ADR-094 Decision 4: the reconciliation sweep is the offboarding backstop.
import { describe, expect, it, vi } from "vitest";

import { createIdentityLinksMaintenancePipeline } from "../pipeline";
import {
  ORPHAN_LINK_SWEEP_PROCESS_NAME,
  orphanLinkSweepWake,
  runOrphanLinkSweep,
} from "../process-manager/orphanLinkSweep.process";

const wakeContext = (at: number) => ({
  at,
  now: at,
  key: ORPHAN_LINK_SWEEP_PROCESS_NAME,
  projectId: "__global__",
  intents: {
    sweep: (key: string, payload: unknown) => ({ type: "sweep", key, payload }),
  },
});

describe("orphanLinkSweep process", () => {
  describe("given the schedule fires", () => {
    describe("when the wake handler runs", () => {
      it("emits one sweep intent keyed by the tick", () => {
        const evolution = orphanLinkSweepWake(
          { lastSweepAt: null },
          wakeContext(1_000) as never,
        );

        expect(evolution.state).toEqual({ lastSweepAt: 1_000 });
        expect(evolution.intents).toEqual([
          {
            type: "sweep",
            key: "sweep:1000",
            payload: { scheduledFor: 1_000 },
          },
        ]);
      });

      it("keys the intent by the tick so a redelivered wake collapses", () => {
        const first = orphanLinkSweepWake(
          { lastSweepAt: null },
          wakeContext(2_000) as never,
        );
        const redelivered = orphanLinkSweepWake(
          { lastSweepAt: 2_000 },
          wakeContext(2_000) as never,
        );

        expect(redelivered.intents?.[0]).toEqual(first.intents?.[0]);
        expect(redelivered.intents?.[0]).toBeDefined();
      });
    });
  });

  describe("when the sweep intent runs", () => {
    it("runs one pass and prunes its own bookkeeping rows", async () => {
      const sweep = vi.fn(async () => ({ candidates: 2, closed: 1 }));
      const deleteDispatchedBefore = vi.fn(async () => 0);

      await runOrphanLinkSweep({
        sweep,
        deleteDispatchedBefore,
        now: () => 10_000_000,
      })();

      expect(sweep).toHaveBeenCalledTimes(1);
      expect(deleteDispatchedBefore).toHaveBeenCalledWith({
        processName: ORPHAN_LINK_SWEEP_PROCESS_NAME,
        before: 10_000_000 - 7 * 24 * 60 * 60 * 1000,
      });
    });

    it("still resolves when the retention prune fails — a bookkeeping failure must not retry the scan", async () => {
      const sweep = vi.fn(async () => ({ candidates: 0, closed: 0 }));

      await expect(
        runOrphanLinkSweep({
          sweep,
          deleteDispatchedBefore: vi.fn(async () => {
            throw new Error("prune failed");
          }),
        })(),
      ).resolves.toBeUndefined();
    });
  });

  describe("the pipeline shape", () => {
    it("is a scheduled-only process behind a lease", () => {
      const pipeline = createIdentityLinksMaintenancePipeline({
        orphanSweep: {
          sweep: async () => ({ candidates: 0, closed: 0 }),
          deleteDispatchedBefore: async () => 0,
        },
      });

      const pm = pipeline.processManagers.get(ORPHAN_LINK_SWEEP_PROCESS_NAME);
      expect(pm).toBeDefined();
      expect(pm?.config.schedule?.everyMs).toBeGreaterThan(0);
      // No event handlers: a scheduled-only process must not register a
      // subscriber, or a maintenance sweep starts costing per-event work.
      expect(pm?.config.eventTypes).toHaveLength(0);
      // The scan runs behind the lease, not in the wake commit.
      expect(pm?.config.outbox?.leaseDurationMs).toBeGreaterThan(0);
    });
  });
});
