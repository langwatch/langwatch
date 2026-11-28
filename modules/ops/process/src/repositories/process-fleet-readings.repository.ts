import { z } from "zod";

import type { ProcessNameCounts } from "./process-ops.repository.ts";

export const processFleetReadingSchema = z.object({
  processName: z.string(),
  instances: z.number(),
  overdueWakes: z.number(),
  pendingMessages: z.number(),
  overduePending: z.number(),
  lapsedLeases: z.number(),
  deadMessages: z.number(),
}) satisfies z.ZodType<ProcessNameCounts>;

/** One process manager's counts, as the last measurement of the fleet read them. */
export type ProcessFleetReading = ProcessNameCounts;

/** One measurement of the whole fleet and when it was taken, so a reader can tell it is stale. */
export const processFleetSnapshotSchema = z.object({
  takenAtMs: z.number(),
  readings: z.array(processFleetReadingSchema),
});

export type ProcessFleetSnapshot = z.infer<typeof processFleetSnapshotSchema>;

/**
 * The fleet's shared process counts: one process measures, every process's gauges read, so
 * N replicas never repeat the aggregate query. A save replaces the last measurement.
 */
export abstract class ProcessFleetReadingsRepository {
  abstract save(snapshot: ProcessFleetSnapshot): Promise<void>;
  abstract find(): Promise<ProcessFleetSnapshot | null>;
}
