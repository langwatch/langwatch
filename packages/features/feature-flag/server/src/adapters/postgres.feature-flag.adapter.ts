import {
  FEATURE_FLAG_REGISTRY,
  type FeatureFlagConfig,
  type FeatureFlagRegistry,
} from "@langwatch/feature-flag-contract";
import type { FeatureFlagCachePort } from "../ports/feature-flag-cache.port";
import {
  PrismaFeatureFlagExperimentRepository,
  type FeatureFlagExperimentDatabase,
} from "../repositories/prisma.feature-flag-experiment-setting.repository";
import {
  PrismaFeatureFlagRepository,
  type FeatureFlagDatabase,
} from "../repositories/prisma.feature-flag.repository";
import { FeatureFlagService } from "../services/feature-flag.service";
import { FeatureFlagRowStore } from "../stores/feature-flag-row.store";

/**
 * Builds the feature flag graph a process runs on.
 *
 * The composition root owns the database client, the shared cache with its
 * key prefix and TTL, resolved configuration and the clock. Construct one per
 * process: the service holds a per-process cache tier whose value depends
 * on being shared by every caller in that process.
 */
export class PostgresFeatureFlagAdapter {
  static create(options: {
    database: FeatureFlagDatabase & FeatureFlagExperimentDatabase;
    cache: FeatureFlagCachePort;
    config: FeatureFlagConfig;
    now: () => number;
    registry?: FeatureFlagRegistry;
  }): FeatureFlagService {
    const repository = PrismaFeatureFlagRepository.create(options.database);

    return FeatureFlagService.create({
      repository,
      experiments: PrismaFeatureFlagExperimentRepository.create(options.database),
      rows: FeatureFlagRowStore.create({
        repository,
        cache: options.cache,
        now: options.now,
      }),
      config: options.config,
      registry: options.registry ?? FEATURE_FLAG_REGISTRY,
    });
  }
}
