import type { DataRetentionService as DataRetentionServiceContract } from "@langwatch/data-retention-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  RedisDataRetentionCacheStore,
  type DataRetentionRedis,
} from "../stores/data-retention-cache.store";
import type { DataRetentionDatabasePort } from "../ports/data-retention-database.port";
import { PrismaDataRetentionRepository } from "../repositories/prisma/prisma-data-retention.repository";
import { PrismaPinnedTraceRepository } from "../repositories/prisma/prisma-pinned-trace.repository";
import { DataRetentionService } from "../services/data-retention.service";

export class PrismaDataRetentionAdapter {
  static create(options: {
    database: DataRetentionDatabasePort;
    projects: ProjectService;
    organizations: OrganizationService;
    defaultRetentionDays: number;
    redis?: DataRetentionRedis | null;
    cacheTtlMs?: number;
  }): DataRetentionServiceContract {
    return DataRetentionService.create({
      repository: PrismaDataRetentionRepository.create(options),
      projects: options.projects,
      organizations: options.organizations,
      defaultRetentionDays: options.defaultRetentionDays,
      pinRepository: PrismaPinnedTraceRepository.create(options),
      cache: RedisDataRetentionCacheStore.create({
        redis: options.redis,
        ttlMs: options.cacheTtlMs ?? 60_000,
      }),
    });
  }
}
