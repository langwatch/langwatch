import { HandledError, isTransientRefusal } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type {
  ProcessFleetReading,
  ProcessFleetReadingsRepository,
} from "../repositories/process-fleet-readings.repository.ts";
import type { ProcessOpsRepository } from "../repositories/process-ops.repository.ts";
import { OVERDUE_PENDING_MS, OVERDUE_WAKE_MS } from "./manager-explorer.service.ts";

/** Four `ops_storage_stats` wakes: older readings mean the collection has stopped working. */
export const FLEET_READINGS_STALE_AFTER_MS = 60_000;

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

  /** A failed read keeps the last counts; they go stale and the gauges report the failure. */
  async collect(): Promise<void> {
    try {
      const takenAtMs = nowInstant().epochMilliseconds;
      const readings = await this.options.fleet.countByProcessName({
        now: takenAtMs,
        overdueWakeMs: OVERDUE_WAKE_MS,
        overduePendingMs: OVERDUE_PENDING_MS,
      });
      await this.options.readings.save({ takenAtMs, readings });
    } catch (error) {
      const transient = error instanceof HandledError && isTransientRefusal(error);
      this.options.logger[transient ? "warn" : "error"](
        { error },
        "failed to collect fleet counts",
      );
    }
  }

  /**
   * The shared counts the gauges report. Missing or stale counts are refused, so the fleet
   * collection gauge reads 0 and its last-success time stops instead of serving old numbers.
   */
  async currentReadings(): Promise<ProcessFleetReading[]> {
    const snapshot = await this.options.readings.find();
    const age = snapshot ? nowInstant().epochMilliseconds - snapshot.takenAtMs : Infinity;
    if (!snapshot || age > FLEET_READINGS_STALE_AFTER_MS) {
      throw new Error("the shared fleet counts are missing or stale");
    }
    return snapshot.readings;
  }
}
