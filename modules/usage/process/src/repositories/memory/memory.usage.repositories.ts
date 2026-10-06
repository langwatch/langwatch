import type { UsageRepositories } from "../usage.repositories.ts";
import { MemoryBillableEventsMeterRepository } from "./memory.billable-events-meter.repository.ts";
import { MemoryTraceMeterRepository } from "./memory.trace-meter.repository.ts";

export class MemoryUsageRepositories {
  static readonly requires = [] as const;

  static create(): UsageRepositories {
    return {
      billableEvents: MemoryBillableEventsMeterRepository.create(),
      traces: MemoryTraceMeterRepository.create(),
    };
  }
}
