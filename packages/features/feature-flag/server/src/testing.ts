import {
  FEATURE_FLAG_REGISTRY,
  resolveFeatureFlagConfig,
  type FeatureFlagConfig,
  type FeatureFlagRegistry,
} from "@langwatch/feature-flag-contract";
import { FeatureFlagCachePort, type FeatureFlagCacheSlot } from "./ports/feature-flag-cache.port";
import { MemoryFeatureFlagExperimentRepository } from "./repositories/memory/feature-flag-experiment-setting.repository";
import { MemoryFeatureFlagRepository } from "./repositories/memory/feature-flag.repository";
import { FeatureFlagService } from "./services/feature-flag.service";
import { FeatureFlagRowStore } from "./stores/feature-flag-row.store";

export { MemoryFeatureFlagExperimentRepository, MemoryFeatureFlagRepository };
export { MemoryFeatureFlagService } from "./services/memory-feature-flag.service";

/** Shared cache tier held in process, for tests that need no Redis. */
export class MemoryFeatureFlagCache extends FeatureFlagCachePort {
  private readonly slots = new Map<string, FeatureFlagCacheSlot>();

  async tryGet(key: string): Promise<FeatureFlagCacheSlot | undefined> {
    return this.slots.get(key);
  }

  async set(key: string, slot: FeatureFlagCacheSlot): Promise<void> {
    this.slots.set(key, slot);
  }

  async delete(key: string): Promise<void> {
    this.slots.delete(key);
  }
}

/**
 * The real service graph over in-process collaborators, so resolver tests
 * exercise the same code path production runs.
 */
export function createInMemoryFeatureFlagService(options?: {
  config?: FeatureFlagConfig;
  now?: () => number;
  registry?: FeatureFlagRegistry;
}): {
  service: FeatureFlagService;
  repository: MemoryFeatureFlagRepository;
  experiments: MemoryFeatureFlagExperimentRepository;
  cache: MemoryFeatureFlagCache;
} {
  const now = options?.now ?? Date.now;
  const config = options?.config ?? resolveFeatureFlagConfig({});
  const repository = MemoryFeatureFlagRepository.create(now);
  const experiments = MemoryFeatureFlagExperimentRepository.create();
  const cache = new MemoryFeatureFlagCache();
  const service = FeatureFlagService.create({
    repository,
    rows: FeatureFlagRowStore.create({ repository, cache, now }),
    experiments,
    config,
    registry: options?.registry ?? FEATURE_FLAG_REGISTRY,
  });

  return { service, repository, experiments, cache };
}
