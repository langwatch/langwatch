// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SEAT_INVOICING_PROCESS_NAME } from "./seat-invoicing.process.ts";

/** One outbox row a minute is bookkeeping; a day of them is kept. */
const PASS_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

interface SeatInvoicingRunDeps {
  /** One pass; each seat change reports its own failure and never stops the next. */
  readonly pass: () => Promise<void>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** The prune is bookkeeping, and a failed one waits for the next pass's. */
export function runSeatInvoicingPass(deps: SeatInvoicingRunDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = deps.now();
    await deps.pass();
    await deps
      .deleteDispatchedBefore({
        processName: SEAT_INVOICING_PROCESS_NAME,
        before: startedAt - PASS_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
