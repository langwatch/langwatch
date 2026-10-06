import type { BillableEventsMeterRepository } from "./billable-events-meter.repository.ts";
import type { TraceMeterRepository } from "./trace-meter.repository.ts";

/** The two meters usage appends to and reads its month's count from. */
export interface UsageRepositories {
  readonly billableEvents: BillableEventsMeterRepository;
  readonly traces: TraceMeterRepository;
}
