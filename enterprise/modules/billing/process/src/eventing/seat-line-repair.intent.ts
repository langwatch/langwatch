// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";

import type { SeatLineRepairOutcome } from "../services/seat-line-repair.service.ts";
import { SEAT_LINE_REPAIR_PROCESS_NAME } from "./seat-line-repair.process.ts";

const logger = createLogger("langwatch:billing:seat-line-repair");

/** One bookkeeping outbox row per tick, pruned like every other recurring process's. */
const REPAIR_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface SeatLineRepairDeps {
  /** Puts every pending seat line back; each failure is counted and retried next pass. */
  repair: () => Promise<SeatLineRepairOutcome>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runSeatLineRepair(deps: SeatLineRepairDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const { repaired, failed, flagged } = await deps.repair();
    if (repaired > 0 || failed > 0) {
      logger.info({ repaired, failed, flagged }, "Seat line repair pass finished");
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: SEAT_LINE_REPAIR_PROCESS_NAME,
        before: startedAt - REPAIR_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Seat line repair outbox retention failed",
      );
    }
  };
}
