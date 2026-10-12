// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentContext } from "@langwatch/eventing";

export const CONNECTED_BILLING_PROCESS_NAME = "connectedBillingTick";

/** Outbox rows are bookkeeping, one per tick, pruned like every recurring process's. */
const TICK_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface ConnectedBillingTickRunDeps {
  /** One tick; each of its jobs reports its own failure and never stops the next. */
  readonly tick: (params: { heartbeat: () => void }) => Promise<void>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** The prune is bookkeeping, and a failed one waits for the next day's. */
export function runConnectedBillingTick(
  deps: ConnectedBillingTickRunDeps,
): (payload: unknown, context: IntentContext) => Promise<void> {
  return async (_payload, context): Promise<void> => {
    const startedAt = deps.now();
    await deps.tick({ heartbeat: () => context.heartbeat?.() });
    await deps
      .deleteDispatchedBefore({
        processName: CONNECTED_BILLING_PROCESS_NAME,
        before: startedAt - TICK_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
