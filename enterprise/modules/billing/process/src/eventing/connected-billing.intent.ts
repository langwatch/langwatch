// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
export const CONNECTED_BILLING_PROCESS_NAME = "connectedBillingTick";

/** Outbox rows are bookkeeping, one per tick, pruned like every recurring process's. */
const TICK_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface ConnectedBillingTickRunDeps {
  /** One tick; each of its jobs reports its own failure and never stops the next. */
  readonly tick: () => Promise<void>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** The prune is bookkeeping, and a failed one waits for the next day's. */
export function runConnectedBillingTick(deps: ConnectedBillingTickRunDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = deps.now();
    await deps.tick();
    await deps
      .deleteDispatchedBefore({
        processName: CONNECTED_BILLING_PROCESS_NAME,
        before: startedAt - TICK_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
