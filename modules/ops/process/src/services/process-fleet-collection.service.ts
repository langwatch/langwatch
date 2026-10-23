import { HandledError, isTransientRefusal } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { ProcessFleetReadingsRepository } from "../repositories/process-fleet-readings.repository.ts";
import type { ProcessOpsRepository } from "../repositories/process-ops.repository.ts";
import { OVERDUE_PENDING_MS, OVERDUE_WAKE_MS } from "./manager-explorer.service.ts";

/**
 * Counts every process manager's instances and outbox once, on the `ops_storage_stats` wake, and
 * shares the counts so each process's `pm_*` gauges read them instead of repeating the query.
 */
export class ProcessFleetCollectionService {
  static create(options: {
    fleet: ProcessOpsRepository;
    readings: ProcessFleetReadingsRepository;
    logger: Pick<Logger, "warn" | "error">;
  }): ProcessFleetCollectionService {
    return new ProcessFleetCollectionService(options);
  }

  private constructor(
    private readonly options: {
      fleet: ProcessOpsRepository;
      readings: ProcessFleetReadingsRepository;
      logger: Pick<Logger, "warn" | "error">;
    },
  ) {}

  /** A failed read keeps the last counts rather than zeroing the gauges. */
  async collect(): Promise<void> {
    try {
      const counts = await this.options.fleet.countByProcessName({
        now: nowInstant().epochMilliseconds,
        overdueWakeMs: OVERDUE_WAKE_MS,
        overduePendingMs: OVERDUE_PENDING_MS,
      });
      await this.options.readings.save(counts);
    } catch (error) {
      const transient = error instanceof HandledError && isTransientRefusal(error);
      this.options.logger[transient ? "warn" : "error"](
        { error },
        "failed to collect fleet counts",
      );
    }
  }
}
