// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { RateLimiter } from "@langwatch/process-stores";

import { RedisSaasRateLimitRepository } from "../redis/redis.saas-rate-limit.repository.ts";
import type { SaasRepositories } from "../saas.repositories.ts";

/** Cloud's live counters: the process's limiter, so every replica shares a window. */
export class LiveSaasRepositories {
  static readonly requires = ["rateLimiter"] as const;

  static create({ rateLimiter }: Readonly<{ rateLimiter: RateLimiter }>): SaasRepositories {
    return { rateLimits: RedisSaasRateLimitRepository.create({ limiter: rateLimiter }) };
  }
}
