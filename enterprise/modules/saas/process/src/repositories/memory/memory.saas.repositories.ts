// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SaasRepositories } from "../saas.repositories.ts";
import { MemorySaasRateLimitRepository } from "./memory.saas-rate-limit.repository.ts";

export class MemorySaasRepositories {
  static readonly requires = [] as const;

  static create(): SaasRepositories {
    return { rateLimits: MemorySaasRateLimitRepository.create() };
  }
}
