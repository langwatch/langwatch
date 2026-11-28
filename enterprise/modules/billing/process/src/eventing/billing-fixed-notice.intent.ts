// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";

import { BILLING_FIXED_NOTICE_PROCESS_NAME } from "./billing-fixed-notice.process.ts";

const logger = createLogger("langwatch:billing:billing-fixed-notice");

/** One bookkeeping outbox row per tick, pruned like every other recurring process's. */
const NOTICE_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface BillingFixedNoticeDeps {
  /** Emails each waiting admin whose organization is no longer blocked. */
  notice: () => Promise<{ sent: number; waiting: number }>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runBillingFixedNotice(deps: BillingFixedNoticeDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const { sent, waiting } = await deps.notice();
    if (sent > 0) logger.info({ sent, waiting }, "Billing-fixed emails sent");

    try {
      await deps.deleteDispatchedBefore({
        processName: BILLING_FIXED_NOTICE_PROCESS_NAME,
        before: startedAt - NOTICE_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Billing-fixed notice outbox retention failed",
      );
    }
  };
}
