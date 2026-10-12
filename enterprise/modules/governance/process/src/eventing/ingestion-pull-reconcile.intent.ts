// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { IntentContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:governance:ingestion-pull-reconcile");

export const INGESTION_PULL_RECONCILE_PROCESS_NAME = "ingestionPullReconcile";

/** Outbox rows are bookkeeping, one per boot, pruned like every recurring process's. */
const RECONCILE_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface IngestionPullReconcileRunDeps {
  readonly reconcile: (params: {
    heartbeat: () => void;
  }) => Promise<{ reconciled: number; failed: number }>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** A source that fails to reconcile waits for the next boot, as main's did; the prune is bookkeeping. */
export function runIngestionPullReconcile(
  deps: IngestionPullReconcileRunDeps,
): (payload: unknown, context: IntentContext) => Promise<void> {
  return async (_payload, context): Promise<void> => {
    const startedAt = deps.now();
    const { reconciled, failed } = await deps.reconcile({
      heartbeat: () => context.heartbeat?.(),
    });
    if (failed > 0) {
      logger.warn(
        { reconciled, failed },
        "Some ingestion pull processes failed reconciliation; the next boot retries",
      );
    }
    await deps
      .deleteDispatchedBefore({
        processName: INGESTION_PULL_RECONCILE_PROCESS_NAME,
        before: startedAt - RECONCILE_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
