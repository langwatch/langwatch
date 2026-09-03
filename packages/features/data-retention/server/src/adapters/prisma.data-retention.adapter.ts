import type { ClickHouseClient, QueryParams } from "@clickhouse/client";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  RedisDataRetentionCacheStore,
  type DataRetentionRedis,
} from "../stores/data-retention-cache.store";
import type { DataRetentionDatabasePort } from "../ports/data-retention-database.port";
import { PrismaDataRetentionRepository } from "../repositories/prisma/prisma.data-retention.repository";
import { PrismaPinnedTraceRepository } from "../repositories/prisma/prisma.pinned-trace.repository";
import { DataRetentionService } from "../services/data-retention.service";
import { StorageMeterService } from "../services/storage-meter.service";
import type { StorageMeterClickHouseClient } from "../ports/storage-meter-clickhouse.port";
import type { StorageMeterRedis } from "../stores/storage-meter-cache.store";
import {
  ClickHouseRetroactiveRetentionAdapter,
  type TenantClickHouseClientResolver,
} from "./clickhouse.retroactive-retention.adapter";

export class PrismaDataRetentionAdapter {
  static create(options: {
    database: DataRetentionDatabasePort;
    projects: ProjectService;
    organizations: OrganizationService;
    defaultRetentionDays: number;
    redis?: (DataRetentionRedis & StorageMeterRedis) | null;
    cacheTtlMs?: number;
    resolveClickHouseClient?: TenantClickHouseClientResolver | null;
  }): DataRetentionService {
    const resolveClickHouseClient = options.resolveClickHouseClient;
    const storageMeter = StorageMeterService.create({
      resolveClickHouseClient: resolveClickHouseClient
        ? async (tenantId) => {
            const client = await resolveClickHouseClient(tenantId);
            return PrismaDataRetentionAdapter.adaptMeterClient(client);
          }
        : null,
      redis: options.redis,
    });

    return DataRetentionService.create({
      repository: PrismaDataRetentionRepository.create(options),
      projects: options.projects,
      organizations: options.organizations,
      defaultRetentionDays: options.defaultRetentionDays,
      pinRepository: PrismaPinnedTraceRepository.create(options),
      retroactiveRepository: ClickHouseRetroactiveRetentionAdapter.create({
        resolveClickHouseClient: options.resolveClickHouseClient ?? null,
      }),
      cache: RedisDataRetentionCacheStore.create({
        redis: options.redis,
        ttlMs: options.cacheTtlMs ?? 60_000,
      }),
      storageMeter,
    });
  }

  private static adaptMeterClient(client: ClickHouseClient): StorageMeterClickHouseClient {
    return {
      query: async (input: QueryParams) => {
        const result = await client.query(input);
        return { json: () => result.json<unknown>() };
      },
    };
  }
}
