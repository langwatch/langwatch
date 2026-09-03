import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { ShareService as ShareServiceContract } from "@langwatch/share-contract";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { ShareDatabase } from "../ports/share-database.port";
import { LedgerShareRepository } from "../repositories/ledger/ledger.share.repository";
import { PrismaShareRepository } from "../repositories/prisma/prisma.share.repository";
import { RedisShareCacheRepository } from "../repositories/redis/redis.share-cache.repository";
import { ShareService } from "../services/share.service";

export class PostgresShareAdapter {
  static create(options: {
    database: ShareDatabase;
    dataRetention: DataRetentionService;
    projects: ProjectService;
    permissions: AuthzService;
    grants: AuthzGrantsService;
    redis: IORedis | Cluster | null;
  }): ShareServiceContract {
    const legacy = PrismaShareRepository.create({
      database: options.database,
    });
    const repository = LedgerShareRepository.create({
      legacy,
      prisma: options.database,
      grants: options.grants,
      authz: options.permissions,
    });

    return ShareService.create({
      repository,
      dataRetention: options.dataRetention,
      projects: options.projects,
      permissions: options.permissions,
      cache: RedisShareCacheRepository.create({ redis: options.redis }),
    });
  }
}
