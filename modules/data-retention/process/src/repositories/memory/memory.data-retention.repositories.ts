import type { DataRetentionRepositories } from "../data-retention.repositories.ts";
import { MemoryDataRetentionCacheRepository } from "./memory.data-retention-cache.repository.ts";
import { MemoryDataRetentionDirectoryRepository } from "./memory.data-retention-directory.repository.ts";
import { MemoryDataRetentionRepository } from "./memory.data-retention.repository.ts";
import { MemoryPinnedTraceRepository } from "./memory.pinned-trace.repository.ts";
import { MemoryRetroactiveRetentionRepository } from "./memory.retroactive-retention.repository.ts";
import { MemoryStorageMeterCacheRepository } from "./memory.storage-meter-cache.repository.ts";
import { MemoryStorageMeterRepository } from "./memory.storage-meter.repository.ts";

export class MemoryDataRetentionRepositories {
  static readonly requires = [] as const;

  static create(): DataRetentionRepositories {
    return {
      policies: MemoryDataRetentionRepository.create(),
      pins: MemoryPinnedTraceRepository.create(),
      directory: MemoryDataRetentionDirectoryRepository.create(),
      retroactive: MemoryRetroactiveRetentionRepository.create(),
      storageMeter: MemoryStorageMeterRepository.create(),
      cache: MemoryDataRetentionCacheRepository.create(),
      storageMeterCache: MemoryStorageMeterCacheRepository.create(),
    };
  }
}
