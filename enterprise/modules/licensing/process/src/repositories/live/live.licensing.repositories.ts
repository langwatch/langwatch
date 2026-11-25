import type { ObjectStorage, RateLimiter } from "@langwatch/process-stores";

import type { LicensingRepositories } from "../licensing.repositories.ts";
import { ObjectStorageUpgradeDiagnosticBundleRepository } from "../object-storage/object-storage.upgrade-diagnostic-bundle.repository.ts";
import { PostgresLicensingRepositories } from "../prisma/prisma.licensing.repositories.ts";
import { RedisLicensingRateLimitRepository } from "../redis/redis.licensing-rate-limit.repository.ts";

type PostgresInput = Parameters<typeof PostgresLicensingRepositories.create>[0];

/**
 * Licensing's live stores: the rows in Postgres, and the rate-limit windows in
 * the process's Redis limiter, so the keys main wrote are unchanged; diagnostics bundles in
 * object storage under an expiring prefix (ADR-172).
 */
export class LiveLicensingRepositories {
  static readonly requires = ["prisma", "encryption", "rateLimiter", "objectStorage"] as const;

  static create({
    prisma,
    encryption,
    rateLimiter,
    objectStorage,
  }: Readonly<{
    prisma: PostgresInput["prisma"];
    encryption: PostgresInput["encryption"];
    rateLimiter: RateLimiter;
    objectStorage: ObjectStorage;
  }>): LicensingRepositories {
    return {
      ...PostgresLicensingRepositories.create({ prisma, encryption }),
      rateLimits: RedisLicensingRateLimitRepository.create(rateLimiter),
      upgradeDiagnosticBundles:
        ObjectStorageUpgradeDiagnosticBundleRepository.create(objectStorage),
    };
  }
}
