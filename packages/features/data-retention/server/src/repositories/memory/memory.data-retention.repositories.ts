import type { DataRetentionRepositories } from "../data-retention.repositories.ts";
import { MemoryDataRetentionRepository } from "./memory.data-retention.repository.ts";
import { MemoryPinnedTraceRepository } from "./memory.pinned-trace.repository.ts";

export class MemoryDataRetentionRepositories {
  static readonly requires = [] as const;

  static create(): DataRetentionRepositories {
    return {
      policies: MemoryDataRetentionRepository.create(),
      pins: MemoryPinnedTraceRepository.create(),
    };
  }
}
