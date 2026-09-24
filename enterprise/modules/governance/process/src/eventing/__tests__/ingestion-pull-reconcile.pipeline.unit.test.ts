// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";

import {
  INGESTION_PULL_RECONCILE_PROCESS_NAME,
  runIngestionPullReconcile,
} from "../ingestion-pull-reconcile.intent.ts";
import {
  INGESTION_PULL_RECONCILE_PIPELINE_NAME,
  ingestionPullReconcileEventing,
} from "../ingestion-pull-reconcile.pipeline.ts";
import { ingestionPullReconcileWake } from "../ingestion-pull-reconcile.process.ts";

const BOOTED_AT = 1_700_000_000_000;

function wakeAt({ at, lastReconciledAt }: { at: number; lastReconciledAt: number | null }) {
  const reconcile = vi.fn((messageKey: string, payload: { scheduledFor: number }) => ({
    messageKey,
    intentType: "reconcile",
    payload,
  }));
  const evolution = ingestionPullReconcileWake({ bootedAt: BOOTED_AT })(
    { lastReconciledAt },
    {
      at,
      now: at,
      key: INGESTION_PULL_RECONCILE_PROCESS_NAME,
      projectId: "__global__",
      intents: { reconcile },
    },
  );
  return { evolution, reconcile };
}

describe("ingestion pull reconciliation", () => {
  describe("given the reconcile eventing declaration", () => {
    it("names its own pipeline", () => {
      expect(ingestionPullReconcileEventing.pipeline).toBe(INGESTION_PULL_RECONCILE_PIPELINE_NAME);
    });
  });

  describe("given a worker that has just booted", () => {
    it("reconciles once, then not again until the next boot", () => {
      const first = wakeAt({ at: BOOTED_AT + 1_000, lastReconciledAt: BOOTED_AT - 60_000 });
      expect(first.reconcile).toHaveBeenCalledTimes(1);
      const again = wakeAt({
        at: BOOTED_AT + 120_000,
        lastReconciledAt: first.evolution.state.lastReconciledAt,
      });
      expect(again.reconcile).not.toHaveBeenCalled();
    });
  });

  describe("when the reconcile intent runs", () => {
    it("reconciles through the app and prunes its bookkeeping", async () => {
      const reconcile = vi.fn(async () => ({ reconciled: 2, failed: 1 }));
      const deleteDispatchedBefore = vi.fn(async () => 0);
      await runIngestionPullReconcile({
        reconcile,
        deleteDispatchedBefore,
        now: () => BOOTED_AT,
      })();
      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(deleteDispatchedBefore).toHaveBeenCalledWith(
        expect.objectContaining({ processName: INGESTION_PULL_RECONCILE_PROCESS_NAME }),
      );
    });
  });
});
