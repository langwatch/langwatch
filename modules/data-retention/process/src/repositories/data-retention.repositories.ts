import type { DataRetentionDirectoryReader } from "../app/data-retention.app.ts";
import type { DataRetentionCacheRepository } from "./data-retention-cache.repository.ts";
import type { DataRetentionRepository } from "./data-retention.repository.ts";
import type { PinnedTraceRepository } from "./pinned-trace.repository.ts";
import type { RetroactiveRetentionRepository } from "./retroactive-retention.repository.ts";
import type { StorageMeterCacheRepository } from "./storage-meter-cache.repository.ts";
import type { StorageMeterRepository } from "./storage-meter.repository.ts";

export interface DataRetentionRepositories {
  readonly policies: DataRetentionRepository;
  readonly pins: PinnedTraceRepository;
  /** Which organization owns a scope, what it is called, what it resolves to. */
  readonly directory: DataRetentionDirectoryReader;
  /** The rewrite of rows already captured, when a retention change applies to them. */
  readonly retroactive: RetroactiveRetentionRepository;
  /** The bytes a tenant holds, as the storage card and the plan meter read them. */
  readonly storageMeter: StorageMeterRepository;
  /** Resolved retention per project, shared across processes. */
  readonly cache: DataRetentionCacheRepository;
  /** Measured storage per tenant, and who may refresh it. */
  readonly storageMeterCache: StorageMeterCacheRepository;
}
