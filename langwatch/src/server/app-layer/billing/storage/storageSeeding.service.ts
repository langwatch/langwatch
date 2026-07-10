import { createLogger } from "~/utils/logger/server";
import { BILLABLE_AFTER_DAYS } from "./boundaryCalendar";
import type { BoundaryMeasurementService } from "./boundaryMeasurement.service";
import { floorToDay, MS_PER_DAY, partitionStartFor } from "./sealedHour";

const logger = createLogger("langwatch:billing:storageSeeding");

/**
 * How far back seeding walks by default: the migration-grandfathered 308-day
 * retention plus one partition of margin. Orgs holding indefinite-retention
 * (0) data older than this need an explicit --lookback from the operator —
 * the task logs the cap so the truncation is never silent.
 */
export const SEED_DEFAULT_LOOKBACK_DAYS = 308 + 7;

export interface StorageSeedingDeps {
  measurement: Pick<BoundaryMeasurementService, "seedPartition">;
  /** ALL project ids, archived included. */
  listProjectIds: (params: { organizationId: string }) => Promise<string[]>;
}

/**
 * Rollout / re-seed initialization (ADR-039 Decision 6): replays the entry
 * edge over history — one bounded per-partition query at a time, the same
 * code path as steady state. The full-backlog OOM query shape is never run,
 * not even once. Operator-run (the seed task), never automatic; requires
 * the `MATERIALIZE COLUMN _size_bytes` backfill (#5255) first, or old parts
 * hit the lazy-recompute path — the actual expensive shape.
 *
 * Value-idempotent: every partition's emit is cumulative-minus-prior, so a
 * re-run (or a re-seed over a live-tracked, mid-transit partition) emits
 * only what is not yet recorded — and nothing when nothing is missing.
 */
export class StorageSeedingService {
  constructor(private readonly deps: StorageSeedingDeps) {}

  async seedOrganization({
    organizationId,
    at,
    seedRunId,
    lookbackDays = SEED_DEFAULT_LOOKBACK_DAYS,
  }: {
    organizationId: string;
    at: Date;
    /** Cause key for this run's SEED events (distinct per run). */
    seedRunId: string;
    lookbackDays?: number;
  }): Promise<{ partitionsSeeded: number; eventsAppended: number }> {
    // Newest partition with a COMPLETE billable slice … back to the lookback.
    const newestSlice = new Date(
      floorToDay(
        new Date(at.getTime() - BILLABLE_AFTER_DAYS * MS_PER_DAY),
      ).getTime() - MS_PER_DAY,
    );
    const oldest = partitionStartFor(
      new Date(at.getTime() - lookbackDays * MS_PER_DAY),
    );

    const partitionStarts: Date[] = [];
    for (
      let startMs = partitionStartFor(newestSlice).getTime();
      startMs >= oldest.getTime();
      startMs -= 7 * MS_PER_DAY
    ) {
      partitionStarts.push(new Date(startMs));
    }

    const projectIds = await this.deps.listProjectIds({ organizationId });
    logger.info(
      {
        organizationId,
        seedRunId,
        partitions: partitionStarts.length,
        projects: projectIds.length,
        lookbackDays,
      },
      "seeding storage billing gauge from recorded history",
    );

    let eventsAppended = 0;
    for (const projectId of projectIds) {
      for (const partitionStart of partitionStarts) {
        const { appended } = await this.deps.measurement.seedPartition({
          organizationId,
          projectId,
          partitionStart,
          at,
          causeId: seedRunId,
        });
        eventsAppended += appended;
      }
    }

    return {
      partitionsSeeded: partitionStarts.length * projectIds.length,
      eventsAppended,
    };
  }
}
