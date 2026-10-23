import { z } from "zod";

export const processFleetReadingSchema = z.object({
  processName: z.string(),
  instances: z.number(),
  overdueWakes: z.number(),
  pendingMessages: z.number(),
  overduePending: z.number(),
  lapsedLeases: z.number(),
  deadMessages: z.number(),
});

/** One process manager's counts, as the last measurement of the fleet read them. */
export type ProcessFleetReading = z.infer<typeof processFleetReadingSchema>;

/**
 * The fleet's shared process counts: one process measures, every process's gauges read, so
 * N replicas never repeat the aggregate query. A save replaces the whole set.
 */
export abstract class ProcessFleetReadingsRepository {
  abstract save(readings: ProcessFleetReading[]): Promise<void>;
  abstract findAll(): Promise<ProcessFleetReading[]>;
}
