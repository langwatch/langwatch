import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { RateLimiter } from "@langwatch/process-stores";
import type { Encryption, ObjectStorage } from "@langwatch/process-stores/members";

import {
  ClickHouseStoredObjectsRepository,
  RoutedStoredObjectsClickHouse,
} from "../clickhouse/stored-objects.repository.ts";
import { EncryptionStoredObjectSealRepository } from "../encryption/encryption.stored-object-seal.repository.ts";
import { ObjectStorageStoredObjectBytesRepository } from "../object-storage/object-storage.stored-object-bytes.repository.ts";
import { ObjectStorageStoredObjectLegacyStorageRepository } from "../object-storage/object-storage.stored-object-legacy-storage.repository.ts";
import { PostgresStoredObjectRepositories } from "../prisma/prisma.stored-object.repositories.ts";
import { RedisStoredObjectRateLimitRepository } from "../redis/redis.stored-object-rate-limit.repository.ts";
import type { StoredObjectRepositories } from "../stored-object.repositories.ts";

/**
 * Stored Object's live stores: rows in Postgres, the legacy index in ClickHouse,
 * bytes in object storage, read windows in Redis, URL seals in `encryption`.
 */
export class LiveStoredObjectRepositories {
  static readonly requires = [
    "prisma",
    "clickhouse",
    "objectStorage",
    "encryption",
    "rateLimiter",
  ] as const;
  static readonly repositories = PostgresStoredObjectRepositories.repositories;

  static create({
    prisma,
    clickhouse,
    objectStorage,
    encryption,
    rateLimiter,
  }: Readonly<{
    prisma: Parameters<typeof PostgresStoredObjectRepositories.create>[0]["prisma"];
    clickhouse: ClickHouseQueryClient;
    objectStorage: ObjectStorage;
    encryption: Encryption;
    rateLimiter: RateLimiter;
  }>): StoredObjectRepositories {
    return {
      ...PostgresStoredObjectRepositories.create({ prisma }),
      bytes: ObjectStorageStoredObjectBytesRepository.create({ objectStorage }),
      legacyIndex: ClickHouseStoredObjectsRepository.create(
        RoutedStoredObjectsClickHouse.create(clickhouse),
      ),
      legacyStorage: ObjectStorageStoredObjectLegacyStorageRepository.create(objectStorage),
      rateLimits: RedisStoredObjectRateLimitRepository.create(rateLimiter),
      seals: EncryptionStoredObjectSealRepository.create(encryption),
    };
  }
}
