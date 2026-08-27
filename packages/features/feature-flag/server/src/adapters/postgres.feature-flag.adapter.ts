import {
  FEATURE_FLAG_REGISTRY,
  type FeatureFlagConfig,
  type FeatureFlagRegistry,
} from "@langwatch/feature-flag-contract";
import type { FeatureFlagCachePort } from "../ports/feature-flag-cache.port";
import {
  PrismaFeatureFlagExperimentSettingAdapter,
  type FeatureFlagExperimentDatabase,
} from "./prisma.feature-flag-experiment-setting.adapter";
import {
  PrismaFeatureFlagRowAdapter,
  type FeatureFlagDatabase,
} from "./prisma.feature-flag-row.adapter";
import { FeatureFlagService } from "../services/feature-flag.service";
import { CachedFeatureFlagRowAdapter } from "./cached.feature-flag-row.adapter";

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
    const repository = PrismaFeatureFlagRowAdapter.create(options.database);

    return FeatureFlagService.create({
      repository,
      experiments: PrismaFeatureFlagExperimentSettingAdapter.create(options.database),
      rows: CachedFeatureFlagRowAdapter.create({
        repository,
        cache: options.cache,
        now: options.now,
      }),
      config: options.config,
      registry: options.registry ?? FEATURE_FLAG_REGISTRY,
    });
  }
}
