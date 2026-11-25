import { createLogger } from "@langwatch/observability";

import { GATEWAY_REALTIME_SESSION_RECONCILE_PROCESS_NAME } from "./gateway-realtime-session-reconcile.process.ts";

const logger = createLogger("langwatch:gateway:realtime-session-reconcile");

/** One outbox row per tick, pruned on the schedule every other recurring process uses. */
const RECONCILE_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface GatewayRealtimeSessionReconcileDeps {
  /** One reconciliation tick over every open voice session. */
  reconcile: () => Promise<unknown>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runGatewayRealtimeSessionReconcile(
  deps: GatewayRealtimeSessionReconcileDeps,
): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    await deps.reconcile();

    try {
      await deps.deleteDispatchedBefore({
        processName: GATEWAY_REALTIME_SESSION_RECONCILE_PROCESS_NAME,
        before: startedAt - RECONCILE_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Voice session reconcile outbox retention failed",
      );
    }
  };
}
