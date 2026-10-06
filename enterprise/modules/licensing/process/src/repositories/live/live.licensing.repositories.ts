import type { RateLimiter } from "@langwatch/process-stores";

import type { LicensingRepositories } from "../licensing.repositories.ts";
import { PostgresLicensingRepositories } from "../prisma/prisma.licensing.repositories.ts";
import { RedisLicensingRateLimitRepository } from "../redis/redis.licensing-rate-limit.repository.ts";

type PostgresInput = Parameters<typeof PostgresLicensingRepositories.create>[0];

/**
 * Licensing's live stores: the rows in Postgres, and the rate-limit windows in
 * the process's Redis limiter, so the keys main wrote are unchanged.
 */
export class LiveLicensingRepositories {
  static readonly requires = ["prisma", "encryption", "rateLimiter"] as const;

  static create({
    prisma,
    encryption,
    rateLimiter,
  }: Readonly<{
    prisma: PostgresInput["prisma"];
    encryption: PostgresInput["encryption"];
    rateLimiter: RateLimiter;
  }>): LicensingRepositories {
    return {
      ...PostgresLicensingRepositories.create({ prisma, encryption }),
      rateLimits: RedisLicensingRateLimitRepository.create(rateLimiter),
    };
  }
}
