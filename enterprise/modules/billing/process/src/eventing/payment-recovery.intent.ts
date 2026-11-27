// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";

import type { PaymentRecoverySweepOutcome } from "../services/payment-recovery.service.ts";
import { PAYMENT_RECOVERY_PROCESS_NAME } from "./payment-recovery.process.ts";

const logger = createLogger("langwatch:billing:payment-recovery");

/** One bookkeeping outbox row per tick, pruned like every other recurring process's. */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface PaymentRecoverySweepDeps {
  /** Sends each open case's due notice; a case that fails is counted and retried next pass. */
  sweep: () => Promise<PaymentRecoverySweepOutcome>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runPaymentRecoverySweep(deps: PaymentRecoverySweepDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const { notified, closed, failed } = await deps.sweep();
    if (notified > 0 || closed > 0 || failed > 0) {
      logger.info({ notified, closed, failed }, "Payment recovery sweep finished");
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: PAYMENT_RECOVERY_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Payment recovery outbox retention failed",
      );
    }
  };
}
