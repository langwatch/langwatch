// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** How often the fleet asks whether this boot's reconciliation has run yet. */
export const INGESTION_PULL_RECONCILE_CHECK_MS = 60 * 1000;

export const ingestionPullReconcileSchema = z.object({ scheduledFor: z.number().int() });

export interface IngestionPullReconcileState {
  /** Epoch ms of the last reconciliation this process asked for. */
  lastReconciledAt: number | null;
}

export const INGESTION_PULL_RECONCILE_INITIAL_STATE: IngestionPullReconcileState = {
  lastReconciledAt: null,
};

export type IngestionPullReconcileIntents = {
  reconcile: IntentSpec<typeof ingestionPullReconcileSchema>;
};

/** Due once per worker boot, as main's `pipelineSet.ts:132-150` reconciled on every boot and never between. */
export function ingestionPullReconcileWake({
  bootedAt,
}: {
  bootedAt: number;
}): WakeHandler<IngestionPullReconcileState, IngestionPullReconcileIntents> {
  return (state, ctx) => {
    const at = Math.max(ctx.at, ctx.now);
    if (state.lastReconciledAt !== null && state.lastReconciledAt >= bootedAt) return { state };
    return {
      state: { lastReconciledAt: at },
      intents: [ctx.intents.reconcile(`reconcile:${at}`, { scheduledFor: at })],
    };
  };
}
