import type { DataRetentionService as DataRetentionServiceContract } from "@langwatch/data-retention-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  RedisDataRetentionCache,
  type DataRetentionRedis,
} from "../cache/data-retention.cache";
import { PrismaDataRetentionRepository } from "../repositories/prisma/prisma.data-retention.repository";
import { PrismaPinnedTraceRepository } from "../repositories/prisma/pinned-trace.repository";
import type { DataRetentionDatabase } from "../repositories/prisma/data-retention.database";
import { DataRetentionService } from "../services/data-retention.service";

export class PrismaDataRetentionAdapter {
  static create(options: {
    database: DataRetentionDatabase;
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
      cache: RedisDataRetentionCache.create({
        redis: options.redis,
        ttlMs: options.cacheTtlMs ?? 60_000,
      }),
    });
  }
}
