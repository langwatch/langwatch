import type { UsageRepositories } from "../usage.repositories.ts";
import { MemoryBillableEventsMeterRepository } from "./memory.billable-events-meter.repository.ts";
import { MemoryTraceMeterRepository } from "./memory.trace-meter.repository.ts";

export class MemoryUsageRepositories {
  static readonly requires = [] as const;

  static create(): UsageRepositories {
    const billableEvents = MemoryBillableEventsMeterRepository.create();
    return {
      billableEvents,
      traces: MemoryTraceMeterRepository.create({ billableEvents: billableEvents.rows }),
    };
  }
}
